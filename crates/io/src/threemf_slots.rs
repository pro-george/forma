//! Forma: a 3MF for multi-material printing, each part carrying its filament slot (an AMS slot
//! in Bambu Studio and Orca Slicer, an extruder in PrusaSlicer), so a print comes in with every
//! part already on the right filament.
//!
//! The layout is Forma's own (it was proven in the TypeScript Forma's exporter): the core model
//! with one mesh object per part and one object of components per multi-part object, plus two
//! settings files slicers read: `Metadata/model_settings.config` (an `<object>` with
//! `<part subtype="normal_part">` entries, each `<metadata key="extruder">`) and
//! `Metadata/Slic3r_PE_model.config` (volumes addressed by triangle ranges). The `Application`
//! metadata names Forma, so a slicer takes the file as geometry with these settings rather than
//! as one of its own projects.

use std::fmt::Write as _;
use std::io::{Cursor, Write};

use crate::{IoError, Result};
use solidcore_record::Vec3;

/// A part of a printed object: its mesh, in print millimetres as placed, and its slot.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SlotPart {
    pub name: String,
    pub positions: Vec<Vec3>,
    pub triangles: Vec<[u32; 3]>,
    /// The filament slot, 1…16.
    pub slot: u8,
}

/// An object the slicer keeps together: its parts print as one piece of several filaments.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SlotObject {
    pub name: String,
    pub parts: Vec<SlotPart>,
}

fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| !(c.is_control() && !matches!(c, '\t' | '\n' | '\r')))
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&apos;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// A coordinate to a tenth of a micrometre.
fn num(v: f64) -> String {
    let r = (v * 10_000.0).round() / 10_000.0;
    if r == 0.0 { "0".into() } else { format!("{r}") }
}

const IDENTITY: &str = "1 0 0 0 1 0 0 0 1 0 0 0";
const MATRIX: &str = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";

/// The 3MF package of `objects`, titled `title`.
pub fn write_3mf_slots(objects: &[SlotObject], title: &str) -> Result<Vec<u8>> {
    let objects: Vec<&SlotObject> = objects.iter().filter(|o| !o.parts.is_empty()).collect();
    if objects.is_empty() {
        return Err(IoError::Empty);
    }
    for o in &objects {
        for p in &o.parts {
            if p.positions.iter().any(|v| !(v.x.is_finite() && v.y.is_finite() && v.z.is_finite())) {
                return Err(IoError::Invalid(format!("3MF: {} has a point that is not finite", p.name)));
            }
            if p.triangles.iter().flatten().any(|&i| i as usize >= p.positions.len()) {
                return Err(IoError::Invalid(format!("3MF: {} has a triangle past its points", p.name)));
            }
        }
    }
    let slot = |p: &SlotPart| p.slot.clamp(1, 16);
    // Ids: every part's mesh first, then one per object of several parts.
    let mut mesh_id = Vec::new();
    let mut next = 1u32;
    for o in &objects {
        let ids: Vec<u32> = o
            .parts
            .iter()
            .map(|_| {
                next += 1;
                next - 1
            })
            .collect();
        mesh_id.push(ids);
    }
    let object_id: Vec<u32> = objects
        .iter()
        .enumerate()
        .map(|(i, o)| {
            if o.parts.len() > 1 {
                next += 1;
                next - 1
            } else {
                mesh_id[i][0]
            }
        })
        .collect();

    let mut m = String::new();
    let _ = writeln!(m, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    let _ = writeln!(
        m,
        "<model unit=\"millimeter\" xml:lang=\"en-US\" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\" xmlns:BambuStudio=\"http://schemas.bambulab.com/package/2021\">"
    );
    let _ = writeln!(m, " <metadata name=\"Application\">Forma</metadata>");
    let _ = writeln!(m, " <metadata name=\"Title\">{}</metadata>", esc(title));
    let _ = writeln!(m, " <resources>");
    for (i, o) in objects.iter().enumerate() {
        for (k, p) in o.parts.iter().enumerate() {
            let _ = writeln!(m, "  <object id=\"{}\" name=\"{}\" type=\"model\">", mesh_id[i][k], esc(&p.name));
            let _ = writeln!(m, "   <mesh>\n    <vertices>");
            for v in &p.positions {
                let _ = writeln!(m, "     <vertex x=\"{}\" y=\"{}\" z=\"{}\"/>", num(v.x), num(v.y), num(v.z));
            }
            let _ = writeln!(m, "    </vertices>\n    <triangles>");
            for t in &p.triangles {
                let _ = writeln!(m, "     <triangle v1=\"{}\" v2=\"{}\" v3=\"{}\"/>", t[0], t[1], t[2]);
            }
            let _ = writeln!(m, "    </triangles>\n   </mesh>\n  </object>");
        }
    }
    for (i, o) in objects.iter().enumerate() {
        if o.parts.len() < 2 {
            continue;
        }
        let _ = writeln!(m, "  <object id=\"{}\" name=\"{}\" type=\"model\">\n   <components>", object_id[i], esc(&o.name));
        for id in &mesh_id[i] {
            let _ = writeln!(m, "    <component objectid=\"{id}\" transform=\"{IDENTITY}\"/>");
        }
        let _ = writeln!(m, "   </components>\n  </object>");
    }
    let _ = writeln!(m, " </resources>\n <build>");
    for id in &object_id {
        let _ = writeln!(m, "  <item objectid=\"{id}\" transform=\"{IDENTITY}\" printable=\"1\"/>");
    }
    let _ = writeln!(m, " </build>\n</model>");

    // Bambu Studio and Orca Slicer.
    let mut b = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<config>\n");
    for (i, o) in objects.iter().enumerate() {
        let name = if o.parts.len() > 1 { &o.name } else { &o.parts[0].name };
        let _ = writeln!(b, "  <object id=\"{}\">", object_id[i]);
        let _ = writeln!(b, "    <metadata key=\"name\" value=\"{}\"/>", esc(name));
        let _ = writeln!(b, "    <metadata key=\"extruder\" value=\"{}\"/>", slot(&o.parts[0]));
        for (k, p) in o.parts.iter().enumerate() {
            let _ = writeln!(b, "    <part id=\"{}\" subtype=\"normal_part\">", mesh_id[i][k]);
            let _ = writeln!(b, "      <metadata key=\"name\" value=\"{}\"/>", esc(&p.name));
            let _ = writeln!(b, "      <metadata key=\"matrix\" value=\"{MATRIX}\"/>");
            let _ = writeln!(b, "      <metadata key=\"extruder\" value=\"{}\"/>", slot(p));
            let _ = writeln!(
                b,
                "      <mesh_stat face_count=\"{}\" edges_fixed=\"0\" degenerate_facets=\"0\" facets_removed=\"0\" facets_reversed=\"0\" backwards_edges=\"0\"/>",
                p.triangles.len()
            );
            let _ = writeln!(b, "    </part>");
        }
        let _ = writeln!(b, "  </object>");
    }
    b.push_str("</config>\n");

    // PrusaSlicer: volumes by triangle ranges of the object's parts, in order.
    let mut pr = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<config>\n");
    for (i, o) in objects.iter().enumerate() {
        let name = if o.parts.len() > 1 { &o.name } else { &o.parts[0].name };
        let _ = writeln!(pr, "  <object id=\"{}\" instances_count=\"1\">", object_id[i]);
        let _ = writeln!(pr, "    <metadata type=\"object\" key=\"name\" value=\"{}\"/>", esc(name));
        if o.parts.len() == 1 {
            let _ = writeln!(pr, "    <metadata type=\"object\" key=\"extruder\" value=\"{}\"/>", slot(&o.parts[0]));
        }
        let mut first = 0usize;
        for p in &o.parts {
            let last = (first + p.triangles.len()).saturating_sub(1);
            let _ = writeln!(pr, "    <volume firstid=\"{first}\" lastid=\"{last}\">");
            let _ = writeln!(pr, "      <metadata type=\"volume\" key=\"name\" value=\"{}\"/>", esc(&p.name));
            let _ = writeln!(pr, "      <metadata type=\"volume\" key=\"volume_type\" value=\"ModelPart\"/>");
            let _ = writeln!(pr, "      <metadata type=\"volume\" key=\"extruder\" value=\"{}\"/>", slot(p));
            let _ = writeln!(pr, "    </volume>");
            first += p.triangles.len();
        }
        let _ = writeln!(pr, "  </object>");
    }
    pr.push_str("</config>\n");

    let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\n <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\n <Default Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/>\n <Default Extension=\"config\" ContentType=\"application/xml\"/>\n</Types>\n";
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n <Relationship Target=\"/3D/3dmodel.model\" Id=\"rel0\" Type=\"http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel\"/>\n</Relationships>\n";
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let files = [
        ("[Content_Types].xml", content_types.as_bytes()),
        ("_rels/.rels", rels.as_bytes()),
        ("3D/3dmodel.model", m.as_bytes()),
        ("Metadata/model_settings.config", b.as_bytes()),
        ("Metadata/Slic3r_PE_model.config", pr.as_bytes()),
    ];
    for (name, data) in files {
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(zip::DateTime::default())
            .large_file(data.len() as u64 >= u32::MAX as u64);
        zip.start_file(name, opts).map_err(|e| IoError::Invalid(format!("3MF: {e}")))?;
        zip.write_all(data).map_err(|e| IoError::Invalid(format!("3MF: {e}")))?;
    }
    zip.finish().map(|c| c.into_inner()).map_err(|e| IoError::Invalid(format!("3MF: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tri(name: &str, slot: u8, dx: f64) -> SlotPart {
        SlotPart {
            name: name.into(),
            positions: vec![Vec3::new(dx, 0.0, 0.0), Vec3::new(dx + 1.0, 0.0, 0.0), Vec3::new(dx, 1.0, 0.0), Vec3::new(dx, 0.0, 1.0)],
            triangles: vec![[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
            slot,
        }
    }

    /// Every part carries its slot in both slicers' settings; a multi-part object is one object
    /// of components, a single part an object of its own.
    #[test]
    fn parts_carry_their_slots() {
        let objects = vec![
            SlotObject { name: "Ground floor".into(), parts: vec![tri("Walls", 1, 0.0), tri("Frames", 2, 3.0), tri("Glass", 3, 6.0)] },
            SlotObject { name: "Roof".into(), parts: vec![tri("Roof", 4, 10.0)] },
        ];
        let bytes = write_3mf_slots(&objects, "House 1:100").unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut read = |n: &str| {
            let mut s = String::new();
            std::io::Read::read_to_string(&mut zip.by_name(n).unwrap(), &mut s).unwrap();
            s
        };
        let model = read("3D/3dmodel.model");
        let bambu = read("Metadata/model_settings.config");
        let prusa = read("Metadata/Slic3r_PE_model.config");
        // Parts 1-4, the floor's object of components 5; the roof is its own mesh, 4.
        assert!(model.contains("<object id=\"5\" name=\"Ground floor\" type=\"model\">"), "{model}");
        assert!(model.contains("<component objectid=\"3\""), "{model}");
        assert!(model.contains("<item objectid=\"5\""), "{model}");
        assert!(model.contains("<item objectid=\"4\""), "{model}");
        assert!(model.contains("<metadata name=\"Application\">Forma</metadata>"));
        for (id, slot) in [(1, 1), (2, 2), (3, 3)] {
            assert!(bambu.contains(&format!("<part id=\"{id}\" subtype=\"normal_part\">")), "{bambu}");
            assert!(bambu.contains(&format!("<metadata key=\"extruder\" value=\"{slot}\"/>")), "{bambu}");
        }
        assert!(bambu.contains("<object id=\"4\">\n    <metadata key=\"name\" value=\"Roof\"/>\n    <metadata key=\"extruder\" value=\"4\"/>"), "{bambu}");
        assert!(prusa.contains("<volume firstid=\"4\" lastid=\"7\">"), "{prusa}");
        assert!(prusa.contains("<metadata type=\"object\" key=\"extruder\" value=\"4\"/>"), "{prusa}");
    }

    #[test]
    fn nothing_or_broken_meshes_are_refused() {
        assert!(write_3mf_slots(&[], "x").is_err());
        let mut p = tri("a", 1, 0.0);
        p.triangles.push([0, 1, 9]);
        assert!(write_3mf_slots(&[SlotObject { name: "a".into(), parts: vec![p] }], "x").is_err());
        let mut p = tri("a", 1, 0.0);
        p.positions[0].x = f64::NAN;
        assert!(write_3mf_slots(&[SlotObject { name: "a".into(), parts: vec![p] }], "x").is_err());
    }
}
