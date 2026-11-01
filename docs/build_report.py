"""Tạo báo cáo DOCX: phân tích chi phí phiên làm việc và so sánh phương án."""
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_LINE_SPACING

INK = "1B1F3B"
ACCENT = "4F46E5"
MUTED = "5B6070"
BORDER = "D9DCE7"
ZEBRA = "F5F6FA"
CALLOUT = "F1F2FC"
HEAD_BG = "1F2447"
FONT = "Segoe UI"

OUT = r"D:\IT\mail-service\docs\bao-cao-chi-phan-tich.docx"
IMG = r"D:\IT\mail-service\docs\preview.png"
CROPPED = r"D:\IT\mail-service\docs\preview-report.png"

# cắt bớt khoảng trắng của ảnh chụp để đưa vào báo cáo
from PIL import Image as PILImage

_src = PILImage.open(IMG)
_src.crop((140, 18, 1300, 818)).save(CROPPED)


# ---------- helpers ----------
def shade(cell, hex_fill):
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tcpr.append(shd)


def cell_margins(table, top=60, bottom=60, left=110, right=110):
    tblpr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for side, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tblpr.append(mar)


def table_borders(table, color=BORDER, sz=4):
    tblpr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(sz))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tblpr.append(borders)


def fix_layout(table, width_cm=16.6):
    """Ép bảng dùng layout cố định để Word tôn trọng độ rộng từng cột."""
    tbl = table._tbl
    tblpr = tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblpr.append(layout)
    tblw = OxmlElement("w:tblW")
    tblw.set(qn("w:w"), str(int(width_cm * 567)))
    tblw.set(qn("w:type"), "dxa")
    tblpr.append(tblw)
    grid = tbl.find(qn("w:tblGrid"))
    if grid is not None:
        for col, cell_width in zip(grid.findall(qn("w:gridCol")), table.rows[0].cells):
            if cell_width.width is not None:
                col.set(qn("w:w"), str(int(cell_width.width.cm * 567)))


def repeat_header(row):
    trpr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trpr.append(el)


def keep_row_together(row):
    trpr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:cantSplit")
    el.set(qn("w:val"), "true")
    trpr.append(el)


def style_run(run, size=10, bold=False, color=INK, italic=False):
    run.font.name = FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = RGBColor.from_string(color)
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(qn(attr), FONT)


def para(doc, text="", size=10, bold=False, color=INK, space_before=0, space_after=6,
         align=WD_ALIGN_PARAGRAPH.JUSTIFY, line=1.25, italic=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    p.alignment = align
    if text:
        style_run(p.add_run(text), size=size, bold=bold, color=color, italic=italic)
    return p


def rich(doc, parts, size=10, space_after=6, line=1.25, align=WD_ALIGN_PARAGRAPH.JUSTIFY):
    """parts: list of (text, bold, color)"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    p.alignment = align
    for chunk in parts:
        text, bold = chunk[0], chunk[1]
        color = chunk[2] if len(chunk) > 2 else INK
        style_run(p.add_run(text), size=size, bold=bold, color=color)
    return p


def bottom_border(paragraph, color=ACCENT, sz=12, space=6):
    ppr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(sz))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    ppr.append(pbdr)


def heading(doc, text, number=None, size=13.5, space_before=16):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(7)
    pf.keep_with_next = True
    if number:
        style_run(p.add_run(f"{number}  "), size=size, bold=True, color=ACCENT)
    style_run(p.add_run(text), size=size, bold=True, color=INK)
    bottom_border(p, color="E3E5F0", sz=6, space=4)
    return p


def subheading(doc, text, space_before=10):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(3)
    pf.keep_with_next = True
    style_run(p.add_run(text), size=10.5, bold=True, color=ACCENT)
    return p


def bullets(doc, items, size=10, space_after=3):
    for item in items:
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent = Cm(0.55)
        pf.first_line_indent = Cm(-0.55)
        pf.space_before = Pt(0)
        pf.space_after = Pt(space_after)
        pf.line_spacing = 1.22
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        style_run(p.add_run("•  "), size=size, color=ACCENT, bold=True)
        if isinstance(item, tuple) and len(item) > 1:
            style_run(p.add_run(item[0]), size=size, bold=True)
            style_run(p.add_run(item[1]), size=size)
        elif isinstance(item, tuple):
            style_run(p.add_run(item[0]), size=size)
        else:
            style_run(p.add_run(item), size=size)


def data_table(doc, headers, rows, widths, right_cols=(), header_bg=HEAD_BG,
               header_color="FFFFFF", size=9.2, first_col_bold=False, zebra=True):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table_borders(table)
    cell_margins(table)
    hdr = table.rows[0]
    repeat_header(hdr)
    for i, head in enumerate(headers):
        cell = hdr.cells[i]
        cell.width = Cm(widths[i])
        shade(cell, header_bg)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.space_before = Pt(1)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT if i in right_cols else WD_ALIGN_PARAGRAPH.LEFT
        style_run(p.add_run(head), size=size, bold=True, color=header_color)

    for r, row in enumerate(rows):
        cells = table.add_row().cells
        keep_row_together(table.rows[-1])
        for i, value in enumerate(row):
            cell = cells[i]
            cell.width = Cm(widths[i])
            if zebra and r % 2 == 1:
                shade(cell, ZEBRA)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(1.5)
            p.paragraph_format.space_before = Pt(1.5)
            p.paragraph_format.line_spacing = 1.1
            p.alignment = WD_ALIGN_PARAGRAPH.RIGHT if i in right_cols else WD_ALIGN_PARAGRAPH.LEFT
            bold = first_col_bold and i == 0
            style_run(p.add_run(str(value)), size=size, bold=bold,
                      color=INK if not bold else "2A2F52")
    fix_layout(table)
    return table


def callout(doc, lines, bg=CALLOUT, accent=ACCENT):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    cell = table.rows[0].cells[0]
    cell.width = Cm(16.6)
    shade(cell, bg)
    tcpr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge, sz, color in (("left", 24, accent), ("top", 2, "DCDEF5"),
                            ("bottom", 2, "DCDEF5"), ("right", 2, "DCDEF5")):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(sz))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tcpr.append(borders)

    if isinstance(lines, str):
        lines = [(lines, False)]
    first = True
    for text, bold, *rest in lines:
        p = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        pf = p.paragraph_format
        pf.space_before = Pt(2 if not bold else 3)
        pf.space_after = Pt(2)
        pf.line_spacing = 1.2
        style_run(p.add_run(text), size=10 if not bold else 11,
                  bold=bold, color=INK if not bold else "2A2F9E")
    fix_layout(table)
    return table


def spacer(doc, pt=6):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1
    style_run(p.add_run(""), size=pt)
    return p


def add_page_number_footer(section, left_text):
    # xoá tab mặc định của style Footer (8,27 cm centre) để số trang bám mép phải
    try:
        doc.styles["Footer"].paragraph_format.tab_stops.clear_all()
    except Exception:
        pass
    footer = section.footer
    p = footer.paragraphs[0]
    p.paragraph_format.space_before = Pt(4)
    tabs = p.paragraph_format.tab_stops
    tabs.clear_all()
    tabs.add_tab_stop(Cm(16.6), WD_TAB_ALIGNMENT.RIGHT)
    style_run(p.add_run(left_text), size=8, color=MUTED)
    style_run(p.add_run("\tTrang "), size=8, color=MUTED)

    run = p.add_run()
    style_run(run, size=8, color=MUTED)
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)

    style_run(p.add_run(" / "), size=8, color=MUTED)
    run2 = p.add_run()
    style_run(run2, size=8, color=MUTED)
    b2 = OxmlElement("w:fldChar")
    b2.set(qn("w:fldCharType"), "begin")
    i2 = OxmlElement("w:instrText")
    i2.set(qn("xml:space"), "preserve")
    i2.text = " NUMPAGES "
    e2 = OxmlElement("w:fldChar")
    e2.set(qn("w:fldCharType"), "end")
    run2._r.append(b2)
    run2._r.append(i2)
    run2._r.append(e2)


# ---------- document ----------
doc = Document()
section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.top_margin = Cm(2.0)
section.bottom_margin = Cm(1.8)
section.left_margin = Cm(2.2)
section.right_margin = Cm(2.2)

normal = doc.styles["Normal"]
normal.font.name = FONT
normal.font.size = Pt(10)
normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.25

# --- khối tiêu đề ---
kicker = doc.add_paragraph()
kicker.paragraph_format.space_before = Pt(6)
kicker.paragraph_format.space_after = Pt(2)
style_run(kicker.add_run("PHÂN TÍCH CHI PHÍ"), size=8.5, bold=True, color=ACCENT)

title = doc.add_paragraph()
title.paragraph_format.space_before = Pt(0)
title.paragraph_format.space_after = Pt(2)
t1 = title.add_run("Chi phí một phiên agent")
style_run(t1, size=20, bold=True, color=INK)
t1.add_break()
t2 = title.add_run("so với gói thuê bao 20 USD/tháng")
style_run(t2, size=20, bold=True, color=INK)

lede = doc.add_paragraph()
lede.paragraph_format.space_after = Pt(8)
style_run(lede.add_run(
    "Đo lường thực tế trên phiên khởi tạo dự án mail-service (React + Node.js + PostgreSQL), "
    "đối chiếu với Claude Code Pro và API Sonnet 4.5."),
    size=10.5, color=MUTED, italic=False)

meta = doc.add_paragraph()
meta.paragraph_format.space_after = Pt(4)
bottom_border(meta, color=ACCENT, sz=10, space=6)
style_run(meta.add_run(
    "Ngày lập: 01/11/2026     ·     Thời lượng phiên: 18:01 – 18:19     ·     "
    "Đơn vị: USD (trừ khi ghi khác)"),
    size=8.5, color=MUTED)

spacer(doc, 10)

# --- 1. Tóm tắt điều hành ---
heading(doc, "Tóm tắt điều hành", "1", space_before=4)

rich(doc, [
    ("Một yêu cầu duy nhất — khởi tạo dự án hai phần React và Node, dùng PostgreSQL — được thực hiện "
     "trong 19 phút, tiêu thụ ", False),
    ("4,14 triệu token đầu vào", True),
    (" và ", False),
    ("59,2 nghìn token đầu ra", True),
    (" qua ", False),
    ("71 lượt gọi API", True),
    (", với chi phí khoảng ", False),
    ("0,05 USD", True),
    (" — tức 0,0007 USD mỗi lượt gọi.", False),
])

rich(doc, [
    ("Điểm quyết định chi phí là prompt cache: ", False),
    ("96,8%", True),
    (" lượng token đầu vào được phục vụ từ cache nên chi phí biên của mỗi bước suy luận gần như không "
     "đáng kể. Ngược lại, một lần daemon khởi động lại ở cuối phiên đã làm mất cache và khiến "
     "90,8 nghìn token bị tính lại với giá đầy đủ — riêng khoản này chiếm 70% lượng token không được cache.",
     False),
])

rich(doc, [
    ("So với gói Claude Code Pro 20 USD/tháng: quy đổi theo khối lượng công việc, một tác vụ "
     "cùng quy mô tốn khoảng 0,05 USD khi trả theo token, nên điểm hòa vốn của gói thuê bao là khoảng ", False),
    ("400 tác vụ/tháng (13 tác vụ/ngày)", True),
    (". Dưới mức đó, trả theo token rẻ hơn tuyệt đối; trên mức đó, gói thuê bao có lợi về giá nhưng "
     "bị chặn bởi hạn mức sử dụng.", False),
])

spacer(doc, 8)

# ba số chủ đạo
kpi = doc.add_table(rows=1, cols=3)
kpi.alignment = WD_TABLE_ALIGNMENT.CENTER
kpi.autofit = False
table_borders(kpi, color="DCDEF5")
cell_margins(kpi, top=120, bottom=120, left=140, right=140)
for i, (value, label) in enumerate([
    ("0,05 USD", "chi phí một tác vụ"),
    ("96,8%", "token đầu vào từ cache"),
    ("400", "tác vụ/tháng để hòa vốn gói 20 USD"),
]):
    cell = kpi.rows[0].cells[i]
    cell.width = Cm(5.53)
    shade(cell, CALLOUT)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_run(p.add_run(value), size=16, bold=True, color=ACCENT)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_before = Pt(2)
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.05
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    style_run(p2.add_run(label), size=8, color=MUTED)

fix_layout(kpi)

# --- 2. Phạm vi và phương pháp ---
heading(doc, "Phạm vi và phương pháp đo", "2")

rich(doc, [
    ("Số liệu token lấy trực tiếp từ nhật ký của proxy điều phối phiên (billion-context cache ledger), "
     "không phải ước lượng: mỗi lượt gọi được ghi nhận riêng số token đầu vào, số token phục vụ từ cache "
     "và số token đầu ra. Chi phí 0,05 USD là số liệu người dùng cung cấp cho toàn phiên.", False),
])

rich(doc, [
    ("Bảng giá dùng để quy đổi là bảng giá công bố của Anthropic cho Sonnet 4.5: 3 USD/triệu token đầu vào, "
     "15 USD/triệu token đầu ra, 0,30 USD/triệu token đọc cache (0,1×) và 3,75 USD/triệu token ghi cache. "
     "Hạn chế: nhật ký chỉ ghi nhận khối lượng token, không ghi đơn giá của từng loại, nên bảng phân rã "
     "chi phí ở mục 4 là ước tính theo cấu trúc, không phải số liệu hoá đơn.", False),
])

# --- 3. Dữ liệu đo được ---
heading(doc, "Dữ liệu đo được của phiên", "3")

data_table(
    doc,
    ["Chỉ tiêu", "Giá trị", "Ghi chú"],
    [
        ["Số lượt gọi API", "71", "Một yêu cầu người dùng mở ra 71 vòng suy luận – gọi công cụ"],
        ["Thời lượng", "19 phút", "18:01 – 18:19 ngày 01/11/2026"],
        ["Token đầu vào (tổng)", "4.140.000", "Cộng dồn qua 71 lượt gọi"],
        ["— phục vụ từ cache", "4.010.000", "Tỷ lệ cache hit 96,8%"],
        ["— phải trả giá đầy đủ", "130.600", "39.800 token nội dung mới + 90.800 token tính lại"],
        ["Token đầu ra", "59.200", "Suy luận, nội dung tệp, mã nguồn sinh ra"],
        ["Chi phí", "0,05 USD", "≈ 0,0007 USD mỗi lượt gọi"],
        ["Lượt bị ngắt giữa dòng", "6", "Do client huỷ stream; phải gửi lại phần đuôi"],
    ],
    widths=[5.0, 3.4, 8.2],
    right_cols=(1,),
    first_col_bold=True,
)

# --- 4. Phân rã chi phí ---
heading(doc, "Phân rã chi phí và điểm bất thường", "4")

rich(doc, [
    ("Với tỷ lệ cache hit 96,8%, chi phí của phiên không tỉ lệ với số bước suy luận mà tập trung vào ba chỗ: "
     "token mới sinh ra khi đọc/ghi tệp và nhận kết quả công cụ, token đầu ra, và những lần cache bị vô hiệu. "
     "Ở phiên này, 39.800 token nội dung mới là chi phí hợp lý cho một dự án cỡ này — tương đương khoảng "
     "2.000 dòng mã và tài liệu được đọc hoặc sinh ra.", False),
])

rich(doc, [
    ("Bất thường nằm ở lượt gọi cuối (18:19:46): daemon khởi động lại làm toàn bộ tiền tố 91.800 token "
     "bị tính lại với giá đầy đủ. Khoản này bằng ", False),
    ("70%", True),
    (" lượng token không được cache của cả phiên và có thể đắt hơn toàn bộ 19 phút làm việc thực tế. "
     "Nếu cache không bị mất, chi phí phiên ước tính giảm còn 0,02 – 0,03 USD.", False),
])

data_table(
    doc,
    ["Thành phần", "Token", "Tỷ trọng trong phần không cache"],
    [
        ["Nội dung mới (đọc/ghi tệp, kết quả công cụ)", "39.800", "30%"],
        ["Cache bị tính lại do daemon khởi động lại", "90.800", "70%"],
    ],
    widths=[8.0, 3.6, 5.0],
    right_cols=(1, 2),
)

spacer(doc, 4)
callout(doc, [
    ("Kết luận kỹ thuật", True),
    ("Chi phí của một phiên agent phụ thuộc chủ yếu vào việc giữ được prompt cache. Cùng một khối lượng "
     "công việc, phiên bị mất cache giữa chừng có thể tốn gấp 2 – 3 lần phiên chạy liền mạch.", False),
])

# --- 5. Quy đổi Sonnet ---
heading(doc, "Quy đổi sang Sonnet 4.5 API", "5")

intro5 = rich(doc, [
    ("Để so sánh công bằng, áp cùng khối lượng token của phiên lên bảng giá Sonnet — mô hình người dùng "
     "dự định dùng để code. Cần lưu ý Sonnet có giá niêm yết cao hơn khoảng một bậc so với mô hình đang "
     "chạy phiên này.", False),
])
intro5.paragraph_format.keep_with_next = True

data_table(
    doc,
    ["Thành phần", "Phiên hiện tại", "Sonnet 4.5 API"],
    [
        ["Đọc cache (4,01 triệu token)", "≈ 0,01", "1,20"],
        ["Đầu vào mới (130,6 nghìn) + ghi cache", "≈ 0,02", "0,88"],
        ["Đầu ra (59,2 nghìn token)", "≈ 0,02", "0,89"],
        ["Tổng một tác vụ", "0,05", "≈ 2,60"],
    ],
    widths=[8.6, 4.0, 4.0],
    right_cols=(1, 2),
)

spacer(doc, 4)
rich(doc, [
    ("Cùng khối lượng công việc, Sonnet API đắt hơn khoảng ", False),
    ("50 lần", True),
    (". Điều này không có nghĩa Sonnet kém hiệu quả — nó phản ánh việc mô hình đang chạy phiên này được "
     "định giá thấp hơn nhiều trên mỗi token.", False),
])

# --- 6. Ba phương án ---
heading(doc, "Ba phương án theo mức sử dụng", "6")

rich(doc, [
    ("Giả định một tác vụ có quy mô tương đương phiên đo được (một tính năng vừa, khoảng 20 phút máy chạy). "
     "Gói Claude Code Pro 20 USD/tháng là chi phí cố định nhưng có hạn mức: cửa sổ 5 giờ và hạn mức tuần.",
     False),
])

data_table(
    doc,
    ["Mức sử dụng", "Trả theo token", "Sonnet API", "Claude Pro 20 USD"],
    [
        ["10 tác vụ/tháng", "0,50", "≈ 26", "20 — thoải mái trong hạn mức"],
        ["50 tác vụ/tháng", "2,50", "≈ 130", "20 — bắt đầu chạm hạn mức"],
        ["200 tác vụ/tháng", "10,00", "≈ 520", "Vượt hạn mức, cần Max 100 USD"],
    ],
    widths=[4.4, 3.6, 3.4, 5.2],
    right_cols=(1, 2),
    first_col_bold=True,
)

# --- 7. Điểm hòa vốn ---
heading(doc, "Điểm hòa vốn", "7")

rich(doc, [
    ("Với chi phí 0,05 USD mỗi tác vụ, gói 20 USD/tháng tương đương 400 tác vụ — khoảng 13 tác vụ mỗi ngày "
     "nếu làm việc 30 ngày. Đó là ngưỡng so sánh thuần túy về giá.", False),
])

bullets(doc, [
    ("Dưới 13 tác vụ/ngày: ", "trả theo token rẻ hơn nhiều lần. Với 10 tác vụ/tháng, chi phí khoảng "
                                "0,5 USD so với 20 USD."),
    ("Trên 13 tác vụ/ngày: ", "gói thuê bao rẻ hơn trên giấy, nhưng hạn mức thực tế khiến người dùng nặng "
                                "phải nâng lên Max 100 USD/tháng."),
    ("Khi đã ở mức 100 USD/tháng: ", "so sánh nghiêng hẳn về trả theo token, vì 400 tác vụ chỉ tốn khoảng "
                                      "20 USD ở mức giá hiện tại."),
])

spacer(doc, 4)
callout(doc, [
    ("Lưu ý quan trọng", True),
    ("Gói 20 USD không phải \"không giới hạn\". Chi phí cố định, nhưng số lượng bị chặn — nên khi vượt "
     "hạn mức, lựa chọn thực tế không phải \"trả thêm theo dùng\" mà là nâng gói.", False),
])

# --- 8. Kết quả nhận được ---
heading(doc, "Kết quả nhận được với 0,05 USD", "8")

rich(doc, [
    ("Để đặt chi phí vào bối cảnh: 0,05 USD mua được một monorepo hoàn chỉnh gồm API Express 5 với đầy đủ "
     "CRUD, migration và seed cho PostgreSQL, giao diện React 19 có lọc và tìm kiếm, tài liệu README và "
     "một vòng kiểm thử đầu – cuối. Ảnh dưới là giao diện chạy thật với dữ liệu từ cơ sở dữ liệu.", False),
])

pic = doc.add_paragraph()
pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
pic.paragraph_format.space_before = Pt(4)
pic.paragraph_format.space_after = Pt(3)
pic.add_run().add_picture(CROPPED, width=Cm(15.2))

cap = doc.add_paragraph()
cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
cap.paragraph_format.space_after = Pt(10)
style_run(cap.add_run("Giao diện mail-service — sản phẩm của phiên làm việc 19 phút, chi phí 0,05 USD"),
          size=8.5, color=MUTED, italic=True)

# --- 9. Kết luận ---
heading(doc, "Kết luận và khuyến nghị", "9")

subheading(doc, "Về giá", space_before=2)
rich(doc, [
    ("Trả theo token rẻ hơn khoảng 50 lần mỗi tác vụ so với dùng Sonnet qua API, và rẻ hơn gói thuê bao "
     "20 USD cho tới khoảng 400 tác vụ/tháng. Với người dùng phổ thông (dưới 13 tác vụ lớn mỗi ngày), "
     "chi phí thực tế rơi vào 1 – 5 USD/tháng.", False),
])

subheading(doc, "Về giá trị")
rich(doc, [
    ("20 USD không chỉ mua token. Gói thuê bao bao gồm quyền truy cập Sonnet — mô hình mạnh hơn hẳn ở các "
     "bài toán suy luận phức tạp — cùng môi trường Claude Code đã trưởng thành. Ở chiều ngược lại, agent "
     "trả theo token bù lại bằng cách gọi công cụ nhiều hơn (71 lượt cho một tác vụ là khá nhiều) và không "
     "có chi phí cố định.", False),
])

subheading(doc, "Khuyến nghị")
bullets(doc, [
    ("Mô hình hybrid: ", "giữ gói 20 USD cho phần cần Sonnet — thiết kế kiến trúc, review mã, refactor lớn; "
                         "dùng agent trả theo token cho scaffolding, boilerplate, CRUD, viết tài liệu. "
                         "Tổng chi phí dự kiến 22 – 25 USD/tháng."),
    ("Đo trước khi quyết: ", "trong 2 tuần, đếm số tác vụ thực tế mỗi ngày. Nếu dưới 13, gói thuê bao "
                              "không kinh tế; nếu trên 25, cân nhắc Max thay vì cố bám gói 20 USD."),
    ("Giữ phiên liền mạch: ", "với cách trả theo token, chi phí phụ thuộc nhiều vào cache — tránh khởi "
                               "động lại giữa phiên và tránh các tác vụ quá dài trong một lượt."),
])

# --- 10. Giả định ---
heading(doc, "Giả định và giới hạn", "10")

bullets(doc, [
    ("Chi phí 0,05 USD do người dùng cung cấp, chưa được đối chiếu với hoá đơn thực tế của nhà cung cấp.",),
    ("Bảng giá Sonnet lấy theo niêm yết công khai; giá thực tế có thể khác theo khu vực, đối tác "
     "hoặc thời điểm.",),
    ("So sánh dựa trên khối lượng token, không dựa trên chất lượng đầu ra — hai mô hình không tương "
     "đương về năng lực.",),
    ("Không tính chi phí hạ tầng (PostgreSQL, Docker), chi phí lưu trữ hay thời gian chờ của người dùng.",),
    ("Quy mô \"một tác vụ\" được chuẩn hoá theo phiên đo được; tác vụ nhỏ hơn sẽ rẻ hơn đáng kể, "
     "tác vụ lớn hơn có thể gấp 5 – 10 lần.",),
])

heading(doc, "Diễn biến phiên làm việc", "A")

rich(doc, [
    ("Mốc thời gian dưới đây lấy từ nhật ký 71 lượt gọi API của phiên, dùng để đối chiếu khối lượng "
     "công việc với chi phí phát sinh.", False),
])

data_table(
    doc,
    ["Thời điểm", "Hoạt động", "Ghi chú chi phí"],
    [
        ["18:01", "Nhận yêu cầu, tạo monorepo, cài dependencies", "13,7K token khởi tạo"],
        ["18:02 – 18:03", "Dựng server Express + Drizzle, viết migration và seed", ""],
        ["18:03 – 18:07", "Hoàn thiện API mails, health, validate và xử lý lỗi", ""],
        ["18:07 – 18:10", "Giao diện React: form soạn mail, danh sách, bộ lọc, tìm kiếm", ""],
        ["18:10 – 18:13", "Chạy migration/seed trên PostgreSQL, kiểm thử API đầu – cuối", ""],
        ["18:13 – 18:14", "Build production, chụp ảnh giao diện, kiểm tra SPA fallback", ""],
        ["18:19", "Kết thúc phiên; daemon khởi động lại", "90,8K token bị tính lại"],
    ],
    widths=[3.2, 9.4, 4.0],
)

spacer(doc, 10)
note = doc.add_paragraph()
note.paragraph_format.space_before = Pt(6)
bottom_border(note, color="E3E5F0", sz=6, space=6)
note.paragraph_format.space_after = Pt(6)
style_run(note.add_run(
    "Báo cáo được lập từ nhật ký token của phiên làm việc ngày 01/11/2026 tại D:\\IT\\mail-service. "
    "Số liệu token là số đo; các con số chi phí quy đổi là ước tính có giả định nêu rõ."),
    size=8.5, color=MUTED, italic=True)

add_page_number_footer(section, "Báo cáo phân tích chi phí — mail-service")

doc.save(OUT)
print("saved", OUT)
