"""Сборка Word-версий из markdown-текстов страниц сервиса.
Источник истины — файлы Документация/*.md, сгенерированные из React-страниц,
поэтому текст на экране и в Word совпадает дословно.
"""
import os
from docx import Document
from docx.shared import Pt

DOC = "/home/user/queue-service/Документация"

JOBS = [
    (f"{DOC}/Пользовательское-соглашение.md", "/home/user/Пользовательское-соглашение_сервис_v2.docx"),
    (f"{DOC}/Политика-очередь.md", "/home/user/Политика_ПДн_очередь_v2.docx"),
    (f"{DOC}/Согласие-очередь.md", "/home/user/Согласие_ПДн_очередь_v2.docx"),
]


def convert(md_path, out_path):
    lines = open(md_path, encoding="utf-8").read().splitlines()
    doc = Document()
    doc.styles["Normal"].font.name = "Calibri"  # type: ignore[attr-defined]
    doc.styles["Normal"].font.size = Pt(11)  # type: ignore[attr-defined]

    title = None
    subtitle = None
    body = []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# "):
            title = line[2:].strip()
            continue
        if line.startswith("## "):
            body.append(("h", line[3:].strip()))
            continue
        if subtitle is None and title is not None:
            subtitle = line
            continue
        body.append(("p", line))

    doc.add_heading(title or "Документ", level=0)
    if subtitle:
        par = doc.add_paragraph()
        run = par.add_run(subtitle)
        run.italic = True
    for kind, text in body:
        if kind == "h":
            doc.add_heading(text, level=1)
        else:
            doc.add_paragraph(text)
    doc.save(out_path)
    return out_path


if __name__ == "__main__":
    for md, out in JOBS:
        path = convert(md, out)
        print(path, os.path.getsize(path))
