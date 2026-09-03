#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parse Ke dmeta 埋点需求 Excel → events JSON (stdout). No pageName filter."""
from __future__ import print_function

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

EVENT_TYPE_ALIAS = {
    "模块曝光": "Module_View",
    "模块点击": "Module_Click",
    "页面曝光": "Page_View",
    "页面离开": "Page_Disapper",
    "页面消失": "Page_Disapper",
    "Module_View": "Module_View",
    "Module_Click": "Module_Click",
    "Page_View": "Page_View",
    "Page_Disapper": "Page_Disapper",
}

HEADER_ALIASES = {
    "docIndex": ["编号", "序号", "docIndex"],
    "eventTypeZh": ["事件类型"],
    "eventName": ["事件名称", "埋点名称"],
    "pageName": ["页面名称", "页面"],
    "event": ["event", "事件英文名"],
    "evtId": ["evt_id", "evtId", "事件ID", "事件id"],
    "pidUicode": ["pid-uicode组合值", "pid-uicode", "pid/uicode"],
    "pid": ["pid"],
    "uicode": ["uicode"],
    "exposureRatio": ["曝光口径-曝光比例", "曝光比例"],
    "exposureMechanism": ["曝光口径-曝光机制", "曝光机制"],
    "multiScene": ["存在多场景触发"],
    "specialLogic": ["特殊逻辑说明"],
    "remark": ["其他备注"],
    "diagram": ["模块示意图", "示意图", "截图", "埋点截图"],
    "paramLabel": ["参数标签", "参数名", "参数中文名"],
    "paramKey": ["action参数key", "参数key", "参数名key"],
    "paramRequired": ["是否可为空", "是否可空", "是否必填"],
    "paramEnum": ["参数枚举value", "枚举值", "枚举"],
    "paramType": ["参数数值类型", "参数类型", "类型"],
    "paramDesc": ["参数用途说明", "参数说明", "说明"],
}


def cell_text(value):
    if value is None:
        return ""
    return str(value).replace("\xa0", " ").strip()


def col_index(cell_ref):
    match = re.match(r"([A-Z]+)", cell_ref or "")
    if not match:
        return 0
    n = 0
    for ch in match.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def load_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings = []
    for si in root.findall("%ssi" % NS):
        strings.append("".join((t.text or "") for t in si.iter("%st" % NS)))
    return strings


def sheet_name(zf):
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    for el in wb.iter("%ssheet" % NS):
        name = el.attrib.get("name") or ""
        if "埋点" in name or name:
            return name
    return "Sheet1"


def cell_value(cell, strings):
    t = cell.attrib.get("t")
    v = cell.find("%sv" % NS)
    is_el = cell.find("%sis" % NS)
    if t == "s" and v is not None and v.text is not None:
        idx = int(v.text)
        if 0 <= idx < len(strings):
            return strings[idx]
        return ""
    if t == "inlineStr" and is_el is not None:
        return "".join((node.text or "") for node in is_el.iter("%st" % NS))
    if v is not None and v.text is not None:
        return v.text
    return ""


def read_rows(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as zf:
        strings = load_shared_strings(zf)
        name = sheet_name(zf)
        root = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in root.findall(".//%srow" % NS):
            cells = {}
            for c in row.findall("%sc" % NS):
                cells[col_index(c.attrib.get("r", ""))] = cell_value(c, strings)
            if not cells:
                continue
            maxc = max(cells)
            rows.append([cells.get(j, "") for j in range(maxc + 1)])
        return name, rows


def norm_header(text):
    return re.sub(r"\s+", " ", cell_text(text))


def find_header_row(rows):
    for i, row in enumerate(rows[:8]):
        cells = [norm_header(c) for c in row]
        first = cells[0] if cells else ""
        if "声明" in first or "请严格" in first:
            continue
        has_name = any(c in ("事件名称", "埋点名称") for c in cells)
        has_evt = any("evt_id" in c.lower() or c.lower() == "evtid" for c in cells)
        if has_name and has_evt:
            return i
        joined = " ".join(cells)
        if "evt_id" in joined or "事件名称" in joined:
            return i
    return 2 if len(rows) > 2 else 0


EXACT_FIELDS = {"pid", "uicode"}


def pick(headers, row, aliases, exact=False):
    normalized = [norm_header(h) for h in headers]
    for alias in aliases:
        alias_n = norm_header(alias)
        for i, header in enumerate(normalized):
            if header == alias_n:
                return cell_text(row[i]) if i < len(row) else ""
    if exact:
        return ""
    for alias in aliases:
        alias_n = norm_header(alias)
        if len(alias_n) < 4:
            continue
        for i, header in enumerate(normalized):
            if alias_n in header and "pid-uicode" not in header:
                return cell_text(row[i]) if i < len(row) else ""
    return ""


def parse_pid_uicode(text):
    raw = cell_text(text)
    pid = ""
    uicode = ""
    pid_m = re.search(r"pid\s*[:：]\s*([^\n\r]+)", raw, re.I)
    if pid_m:
        pid = pid_m.group(1).strip()
    uicode_m = re.search(r"uicode\s*[:：]\s*([^\n\r]+)", raw, re.I)
    if uicode_m:
        uicode = uicode_m.group(1).strip()
    return pid, uicode


def clean_uicode(raw):
    value = cell_text(raw)
    if not value:
        return ""
    value = re.sub(r"[（(][^）)]*[）)]", "", value)
    value = value.split("\n")[0].strip()
    value = value.split()[0] if value.split() else value
    return value.strip()


def clean_pid(raw):
    value = cell_text(raw)
    if not value:
        return ""
    value = re.sub(r"[（(][^）)]*[）)]", "", value)
    return value.split("\n")[0].strip()


def extract_image_urls(text):
    source = cell_text(text)
    if not source:
        return []
    return re.findall(r"https?://[^\s\"'<>）)]+", source)


def resolve_event_type(event_en, event_zh):
    if event_en and event_en in EVENT_TYPE_ALIAS:
        return EVENT_TYPE_ALIAS[event_en]
    if event_en:
        return event_en
    if event_zh and event_zh in EVENT_TYPE_ALIAS:
        return EVENT_TYPE_ALIAS[event_zh]
    return event_zh or ""


def is_click(event_type):
    return "click" in (event_type or "").lower() or (event_type or "").find("点击") >= 0


def reexpose(mechanism):
    text = cell_text(mechanism)
    if "首次" in text:
        return False
    if "反复" in text:
        return True
    return True


def emptyish(value):
    text = cell_text(value)
    return text in ("", "无", "-", "—", "null", "None")


def make_param(key, required_text, enum_text, value_type, desc, label):
    key = cell_text(key)
    if not key:
        return None
    req = cell_text(required_text)
    enum_v = cell_text(enum_text)
    if emptyish(enum_v):
        enum_v = ""
    return {
        "key": key,
        "label": cell_text(label),
        "requiredText": req or "否",
        "nullable": req == "是",
        "enumText": enum_v,
        "valueType": cell_text(value_type) or "string",
        "desc": cell_text(desc),
    }


def row_map(headers, row):
    out = {}
    for field, aliases in HEADER_ALIASES.items():
        out[field] = pick(headers, row, aliases, exact=(field in EXACT_FIELDS))
    return out


def has_identity(mapped):
    return bool(cell_text(mapped.get("evtId")) or cell_text(mapped.get("eventName")) or cell_text(mapped.get("event")))


def flush_event(buf, mapped, params):
    if not mapped:
        return
    pid, uicode = parse_pid_uicode(mapped.get("pidUicode"))
    pid = clean_pid(mapped.get("pid") or pid)
    uicode_raw = mapped.get("uicode") or uicode
    uicode_clean = clean_uicode(uicode_raw)
    event_type = resolve_event_type(mapped.get("event"), mapped.get("eventTypeZh"))
    diagram = mapped.get("diagram") or ""
    unique_params = []
    seen = set()
    for param in params:
        if not param or param["key"] in seen:
            continue
        seen.add(param["key"])
        unique_params.append(param)
    try:
        doc_index = int(cell_text(mapped.get("docIndex")))
    except ValueError:
        doc_index = None
    buf.append({
        "docIndex": doc_index,
        "evtId": cell_text(mapped.get("evtId")),
        "eventType": event_type,
        "eventTypeZh": cell_text(mapped.get("eventTypeZh")),
        "eventName": cell_text(mapped.get("eventName")),
        "pageName": cell_text(mapped.get("pageName")),
        "pid": pid,
        "uicode": uicode_clean,
        "uicodeRaw": cell_text(uicode_raw),
        "kind": "click" if is_click(event_type) else "view",
        "exposure": {
            "ratio": cell_text(mapped.get("exposureRatio")),
            "mechanism": cell_text(mapped.get("exposureMechanism")),
            "reexpose": reexpose(mapped.get("exposureMechanism")),
        },
        "multiScene": cell_text(mapped.get("multiScene")),
        "specialLogic": "" if emptyish(mapped.get("specialLogic")) else cell_text(mapped.get("specialLogic")),
        "remark": "" if emptyish(mapped.get("remark")) else cell_text(mapped.get("remark")),
        "diagramUrl": (extract_image_urls(diagram) or [""])[0],
        "diagramUrls": extract_image_urls(diagram),
        "params": unique_params,
    })


def parse_events(xlsx_path):
    sheet, rows = read_rows(xlsx_path)
    header_i = find_header_row(rows)
    headers = [norm_header(c) for c in rows[header_i]]
    events = []
    current_mapped = None
    current_params = []
    for row in rows[header_i + 1:]:
        if not any(cell_text(c) for c in row):
            continue
        mapped = row_map(headers, row)
        if current_mapped and not has_identity(mapped) and mapped.get("paramKey"):
            param = make_param(
                mapped.get("paramKey"),
                mapped.get("paramRequired"),
                mapped.get("paramEnum"),
                mapped.get("paramType"),
                mapped.get("paramDesc"),
                mapped.get("paramLabel"),
            )
            if param:
                current_params.append(param)
            continue
        if not has_identity(mapped):
            continue
        flush_event(events, current_mapped, current_params)
        current_mapped = mapped
        first = make_param(
            mapped.get("paramKey"),
            mapped.get("paramRequired"),
            mapped.get("paramEnum"),
            mapped.get("paramType"),
            mapped.get("paramDesc"),
            mapped.get("paramLabel"),
        )
        current_params = [first] if first else []
    flush_event(events, current_mapped, current_params)
    for i, event in enumerate(events):
        if not event.get("docIndex"):
            event["docIndex"] = i + 1
    return sheet, events


def main():
    if len(sys.argv) < 2:
        print("usage: parse_xlsx.py <excel.xlsx>", file=sys.stderr)
        sys.exit(2)
    xlsx_path = sys.argv[1]
    sheet, events = parse_events(xlsx_path)
    json.dump({"sheetName": sheet, "events": events}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
