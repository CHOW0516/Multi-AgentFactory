"""Convert every sheet of an xlsx to CSV using only the standard library."""

import csv
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group()
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def main(src, out_dir):
    z = zipfile.ZipFile(src)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
    rels = {
        r.get("Id"): r.get("Target")
        for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).iter(f"{REL}Relationship")
    }
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    for sheet in wb.find("m:sheets", NS):
        name = sheet.get("name")
        target = rels[sheet.get(f"{{{NS['r']}}}id")].lstrip("/")
        path = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(path)).iter(f"{{{NS['m']}}}row"):
            values = {}
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS)
                t = c.get("t")
                if t == "inlineStr":
                    text = "".join(x.text or "" for x in c.iter(f"{{{NS['m']}}}t"))
                elif v is None:
                    text = ""
                elif t == "s":
                    text = shared[int(v.text)]
                else:
                    text = v.text
                values[col_index(c.get("r"))] = text
            if values:
                rows.append([values.get(i, "") for i in range(max(values) + 1)])
        with open(f"{out_dir}/{name}.csv", "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh).writerows(rows)
        print(name, len(rows), "rows")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
