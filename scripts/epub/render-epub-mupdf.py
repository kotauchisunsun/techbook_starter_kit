#!/usr/bin/env python3
"""Render the actual EPUB archive with MuPDF, not intermediate HTML.

Usage: npm run check:epub:mupdf -- INPUT.epub OUTPUT_DIRECTORY
       [--widths=420,240] [--height=595] [--font-size=11] [--scale=2]
       [--max-pages=1000]

Requires PyMuPDF. Exit 1 means incomplete rendering, an error, or any MuPDF
actionable warning (including unsupported CSS/fonts); screenshots alone are not a pass.
The exact generic EPUB 3.0 version notice is retained as informational.
Geometry/font data describe MuPDF only, not Apple Books or other EPUB readers.
"""

import argparse
import json
import math
from pathlib import Path
import re
import sys


def bounded_number(value, minimum, maximum, integer=False):
    try:
        number = int(value) if integer else float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"Expected a number, got {value!r}") from error
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise argparse.ArgumentTypeError(f"Expected {minimum} to {maximum}, got {value!r}")
    return number


def viewport_widths(value):
    return list(dict.fromkeys(bounded_number(item, 120, 3000, True) for item in value.split(',')))


def parse_arguments(args=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--widths', type=viewport_widths, default=[420, 240])
    parser.add_argument('--height', type=lambda value: bounded_number(value, 120, 3000, True), default=595)
    parser.add_argument('--font-size', type=lambda value: bounded_number(value, 4, 72), default=11)
    parser.add_argument('--scale', type=lambda value: bounded_number(value, 0.5, 4), default=2)
    parser.add_argument('--max-pages', type=lambda value: bounded_number(value, 1, 10000, True), default=1000)
    options = parser.parse_args(args)
    if not options.input.is_file():
        parser.error(f"Input file does not exist: {options.input}")
    return options


def classify_messages(message):
    # MuPDF warns for every OPF version other than exactly "2.0", then
    # continues normal manifest/spine parsing. This specific
    # notice is not evidence of a rendering failure; all other lines still fail.
    # Source: https://github.com/ArtifexSoftware/mupdf/blob/1.26.1/source/html/epub-doc.c
    notices, warnings = [], []
    for line in message.splitlines():
        if line == 'unknown epub version: 3.0':
            notices.append(line)
        elif line.strip():
            warnings.append(line)
    return notices, warnings


def page_information(page):
    # Strip binary image data explicitly. Text spans include actual reported
    # fonts, colors and origins; image blocks retain placement and dimensions.
    blocks = page.get_text('dict')['blocks']
    text, images = [], []
    for block in blocks:
        if block['type'] == 0:
            text.append({
                'bbox': block['bbox'],
                'lines': [{
                    'bbox': line['bbox'], 'direction': line['dir'],
                    'spans': [{key: span[key] for key in
                               ('text', 'bbox', 'origin', 'font', 'size', 'color', 'flags') if key in span}
                              for span in line['spans']],
                } for line in block['lines']],
            })
        elif block['type'] == 1:
            images.append({key: block[key] for key in
                           ('bbox', 'width', 'height', 'ext', 'transform', 'colorspace', 'xres', 'yres') if key in block})
    return {'text': text, 'images': images}


def render_epub(options):
    options.output.mkdir(parents=True, exist_ok=True)
    report = {'input': options.input.name, 'reader': 'MuPDF EPUB renderer',
              'pymupdfVersion': None, 'mupdfVersion': None,
              'fontSize': options.font_size, 'scale': options.scale,
              'coordinateUnits': 'points', 'viewports': [], 'warnings': [], 'notices': [],
              'rawMessages': [], 'errors': [],
              'complete': False, 'failed': True}
    report_path = options.output / 'report.json'

    def save():
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    try:
        import pymupdf as fitz
        report['pymupdfVersion'] = fitz.__version__
        report['mupdfVersion'] = fitz.mupdf_version
        fitz.TOOLS.mupdf_warnings()  # Reset process-local diagnostics before opening.

        def warnings(width, stage):
            message = fitz.TOOLS.mupdf_warnings()
            if message:
                report['rawMessages'].append({'width': width, 'stage': stage, 'message': message})
                notices, actionable = classify_messages(message)
                for key, lines in [('notices', notices), ('warnings', actionable)]:
                    if lines:
                        report[key].append({'width': width, 'stage': stage, 'message': '\n'.join(lines)})

        for width in options.widths:
            viewport = {'width': width, 'height': options.height, 'pageCount': None,
                        'pages': [], 'complete': False}
            report['viewports'].append(viewport)
            directory = options.output / f'{width}x{options.height}'
            directory.mkdir(parents=True, exist_ok=True)
            # Remove only images generated by this script, not arbitrary files.
            for existing in directory.iterdir():
                if existing.is_file() and re.fullmatch(r'page-\d+\.png', existing.name):
                    existing.unlink()
            try:
                with fitz.open(options.input, filetype='epub') as document:
                    if not document.is_reflowable or document.metadata.get('format') != 'EPUB':
                        raise ValueError('Input must be an EPUB archive.')
                    document.layout(width=width, height=options.height, fontsize=options.font_size)
                    viewport['pageCount'] = len(document)
                    warnings(width, 'open-and-layout')
                    if not 0 < len(document) <= options.max_pages:
                        raise ValueError(f"Page count {len(document)} is outside 1..{options.max_pages} at width {width}.")
                    for number, page in enumerate(document, start=1):
                        filename = f'page-{number:04d}.png'
                        page.get_pixmap(matrix=fitz.Matrix(options.scale, options.scale), alpha=False).save(directory / filename)
                        viewport['pages'].append({'sequence': number, 'file': filename,
                                                  'rect': list(page.rect), **page_information(page)})
                        warnings(width, f'page-{number}')
                        save()
                    viewport['complete'] = True
            finally:
                warnings(width, 'viewport-finalize')
            save()
        report['complete'] = True
    except ImportError as error:
        report['errors'].append(f'PyMuPDF is required: {error}')
    except Exception as error:
        report['errors'].append(f'{type(error).__name__}: {error}')
    finally:
        report['failed'] = not report['complete'] or bool(report['errors'] or report['warnings'])
        save()
    count = sum(len(viewport['pages']) for viewport in report['viewports'])
    print(f"{count} EPUB pages captured with MuPDF {report['mupdfVersion']} "
          f"(PyMuPDF {report['pymupdfVersion']}); {len(report['warnings'])} warning batches, "
          f"{len(report['notices'])} informational notices, {len(report['errors'])} errors. Report: {report_path}")
    return report


def main(args=None):
    options = parse_arguments(args)
    try:
        return 1 if render_epub(options)['failed'] else 0
    except OSError as error:
        print(f'Cannot write rendering output: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
