import { PDFDocument, PDFFont, PDFImage, PDFName, PDFPage, PDFString, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';
import {
  AI_CREDENTIALS_13,
  COMPANY_RESUME_DATA,
  CONFIDENTIALITY_STATEMENT,
  CONNECTION_TEST_PROTOCOL,
  DAILY_SCHEDULE,
  DOCUMENT_META,
  EXTRACTED_ASSETS,
  PM_CREDENTIALS,
  PROTOCOL_CLAUSES,
  SENIOR_COACHES_DATA,
} from '../data/protocolData';
import { KhatamProposalDocument } from '../data/khatamProposalsData';
import { saveBinaryFile } from './tauriDesktop';

const bidi = bidiFactory();

const PAGE_W = 595.28; // A4 Portrait width in pt
const PAGE_H = 841.89; // A4 Portrait height in pt

const C_NAVY = rgb(29 / 255, 71 / 255, 96 / 255); // #1D4760
const C_CYAN = rgb(55 / 255, 163 / 255, 220 / 255); // #37A3DC
const C_CYAN_DARK = rgb(2 / 255, 132 / 255, 199 / 255); // #0284C7
const C_CYAN_PALE = rgb(238 / 255, 247 / 255, 252 / 255); // #EEF7FC
const C_LIGHT_BG = rgb(248 / 255, 250 / 255, 252 / 255); // #F8FAFC
const C_INK = rgb(15 / 255, 23 / 255, 42 / 255); // #0F172A
const C_SLATE = rgb(51 / 255, 65 / 255, 85 / 255); // #334155
const C_MUTED = rgb(100 / 255, 116 / 255, 139 / 255); // #64748B
const C_BORDER = rgb(203 / 255, 213 / 255, 225 / 255); // #CBD5E1
const C_WHITE = rgb(1, 1, 1);
const C_SKY_LIGHT = rgb(125 / 255, 211 / 255, 252 / 255); // #7DD3FC

const MARGIN_L = 36;
const MARGIN_R = 36;
const CONTENT_X_RIGHT = PAGE_W - MARGIN_R;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R; // 523.28 pt
const Y_TOP_START = PAGE_H - 76; // Below 59pt header
const Y_BOTTOM_LIMIT = 56; // Above 42pt footer

const TOTAL_PAGES_FA = '۲۲';

const MIRROR_PAIRS: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '«': '»',
  '»': '«',
};

function toPersianDigits(num: number | string): string {
  const digits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(num).replace(/\d/g, (d) => digits[Number(d)]);
}

/**
 * Splits a single visual line into properly ordered LTR/RTL chunks compatible
 * with @pdf-lib/fontkit's OpenType shaper + /ToUnicode CMap so every Persian
 * ligature connects AND inline English / Persian digits render LTR cleanly.
 */
function buildVisualDrawChunks(lineText: string): string[] {
  if (!lineText) return [];
  const levels = bidi.getEmbeddingLevels(lineText, 'rtl');
  const chars = Array.from(lineText);
  const runs: { text: string; level: number; isRtl: boolean }[] = [];

  let start = 0;
  for (let i = 0; i <= chars.length; i++) {
    if (i === chars.length || levels.levels[i] !== levels.levels[start]) {
      const seg = chars.slice(start, i);
      const isRtl = levels.levels[start] % 2 === 1;
      const text = isRtl
        ? seg.map((c) => MIRROR_PAIRS[c] ?? c).join('')
        : seg.join('');
      runs.push({ text, level: levels.levels[start], isRtl });
      start = i;
    }
  }

  // Reorder runs according to UAX #9 L2
  const maxLvl = runs.length > 0 ? Math.max(...runs.map((r) => r.level)) : 1;
  const visRuns = [...runs];
  for (let lvl = maxLvl; lvl >= 1; lvl--) {
    let i = 0;
    while (i < visRuns.length) {
      if (visRuns[i].level >= lvl) {
        let j = i;
        while (j + 1 < visRuns.length && visRuns[j + 1].level >= lvl) {
          j++;
        }
        const reversed = visRuns.slice(i, j + 1).reverse();
        visRuns.splice(i, j - i + 1, ...reversed);
        i = j + 1;
      } else {
        i++;
      }
    }
  }

  // Inside LTR runs, isolate consecutive Persian/Arabic-Indic digits so fontkit
  // does not flip them relative to surrounding ASCII punctuation like '-' or '/'.
  const finalChunks: string[] = [];
  const digitRegex = /([\u06F0-\u06F9\u0660-\u0669]+)/g;
  for (const run of visRuns) {
    if (run.isRtl) {
      finalChunks.push(run.text);
    } else {
      const parts = run.text.split(digitRegex);
      for (const part of parts) {
        if (!part) continue;
        if (/^[\u06F0-\u06F9\u0660-\u0669]+$/.test(part)) {
          finalChunks.push(Array.from(part).reverse().join(''));
        } else {
          finalChunks.push(part);
        }
      }
    }
  }

  return finalChunks;
}

function measureBidiLineWidth(
  font: PDFFont,
  lineText: string,
  size: number
): number {
  const chunks = buildVisualDrawChunks(lineText);
  let total = 0;
  for (const c of chunks) {
    total += font.widthOfTextAtSize(c, size);
  }
  return total;
}

function wrapBidiText(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureBidiLineWidth(font, candidate, size) <= maxWidth - 2) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
          current = word;
        } else {
          // Single very long token (e.g. URL)
          lines.push(word);
          current = '';
        }
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

function drawBidiLine(
  page: PDFPage,
  font: PDFFont,
  lineText: string,
  opts: {
    xRight?: number;
    xLeft?: number;
    centerX?: number;
    y: number;
    size: number;
    color?: ReturnType<typeof rgb>;
    align?: 'right' | 'center' | 'left';
  }
): number {
  const chunks = buildVisualDrawChunks(lineText);
  if (chunks.length === 0) return 0;

  const widths = chunks.map((c) => font.widthOfTextAtSize(c, opts.size));
  const totalW = widths.reduce((a, b) => a + b, 0);

  let cursorX = opts.xLeft ?? MARGIN_L;
  const align = opts.align ?? 'right';
  if (align === 'right') {
    cursorX = (opts.xRight ?? CONTENT_X_RIGHT) - totalW;
  } else if (align === 'center') {
    cursorX = (opts.centerX ?? PAGE_W / 2) - totalW / 2;
  }

  for (let i = 0; i < chunks.length; i++) {
    page.drawText(chunks[i], {
      x: cursorX,
      y: opts.y,
      size: opts.size,
      font,
      color: opts.color ?? C_INK,
    });
    cursorX += widths[i];
  }
  return totalW;
}

function drawWrappedBidiParagraph(
  page: PDFPage,
  font: PDFFont,
  text: string,
  opts: {
    xRight: number;
    y: number;
    maxWidth: number;
    size: number;
    lineHeight?: number;
    color?: ReturnType<typeof rgb>;
    align?: 'right' | 'center' | 'left';
    centerX?: number;
    xLeft?: number;
  }
): number {
  const lh = opts.lineHeight ?? opts.size * 1.48;
  const lines = wrapBidiText(font, text, opts.size, opts.maxWidth);
  let y = opts.y;
  for (const line of lines) {
    if (line !== '') {
      drawBidiLine(page, font, line, {
        xRight: opts.xRight,
        xLeft: opts.xLeft,
        centerX: opts.centerX,
        y,
        size: opts.size,
        color: opts.color ?? C_INK,
        align: opts.align ?? 'right',
      });
    }
    y -= lh;
  }
  return y;
}

function drawBidiBullet(
  page: PDFPage,
  font: PDFFont,
  bulletChar: string,
  text: string,
  opts: {
    xRight: number;
    y: number;
    maxWidth: number;
    size: number;
    lineHeight?: number;
    color?: ReturnType<typeof rgb>;
    bulletColor?: ReturnType<typeof rgb>;
    indent?: number;
  }
): number {
  const indent = opts.indent ?? 12;
  drawBidiLine(page, font, bulletChar, {
    xRight: opts.xRight,
    y: opts.y,
    size: opts.size,
    color: opts.bulletColor ?? opts.color ?? C_INK,
    align: 'right',
  });
  return drawWrappedBidiParagraph(page, font, text, {
    xRight: opts.xRight - indent,
    y: opts.y,
    maxWidth: opts.maxWidth - indent,
    size: opts.size,
    lineHeight: opts.lineHeight,
    color: opts.color ?? C_INK,
  });
}

function drawAccentHeading(
  page: PDFPage,
  font: PDFFont,
  text: string,
  opts: {
    xRight?: number;
    y: number;
    size: number;
    color?: ReturnType<typeof rgb>;
    badgeColor?: ReturnType<typeof rgb>;
  }
): void {
  const xRight = opts.xRight ?? CONTENT_X_RIGHT;
  const sqSize = Math.max(4.5, opts.size * 0.42);
  page.drawRectangle({
    x: xRight - sqSize,
    y: opts.y + opts.size * 0.16,
    width: sqSize,
    height: sqSize,
    color: opts.badgeColor ?? C_CYAN,
  });
  drawBidiLine(page, font, text, {
    xRight: xRight - sqSize - 6,
    y: opts.y,
    size: opts.size,
    color: opts.color ?? C_INK,
    align: 'right',
  });
}

function addPageLinkAnnotation(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  url: string
): void {
  const linkAnnot = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: {
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of(url),
    },
  });
  const annotsKey = PDFName.of('Annots');
  const existing = page.node.get(annotsKey);
  if (existing && 'push' in existing) {
    (existing as unknown as { push: (v: unknown) => void }).push(linkAnnot);
  } else {
    page.node.set(annotsKey, pdfDoc.context.obj([linkAnnot]));
  }
}

async function loadImageForPdf(
  pdfDoc: PDFDocument,
  url: string,
  cache: Map<string, PDFImage | null>
): Promise<PDFImage | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(url, null);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    // Inspect PNG/JPEG magic bytes directly so extensionless/data URLs always work
    const isPng =
      buf.length >= 4 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47;

    let embedded: PDFImage;
    if (isPng) {
      embedded = await pdfDoc.embedPng(buf);
    } else {
      try {
        embedded = await pdfDoc.embedJpg(buf);
      } catch {
        embedded = await pdfDoc.embedPng(buf);
      }
    }
    cache.set(url, embedded);
    return embedded;
  } catch {
    cache.set(url, null);
    return null;
  }
}

function drawImageContain(
  page: PDFPage,
  img: PDFImage | null,
  x: number,
  y: number,
  w: number,
  h: number,
  alignBottom: boolean = false
): void {
  if (!img) return;
  const dims = img.scale(1);
  const scale = Math.min(w / dims.width, h / dims.height);
  const drawW = dims.width * scale;
  const drawH = dims.height * scale;
  const drawX = x + (w - drawW) / 2;
  const drawY = alignBottom ? y : y + (h - drawH) / 2;
  page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
}

interface LoadedFonts {
  main: PDFFont;
  boldTitle: PDFFont;
}

export async function exportProposalToVectorPdf(
  proposal: KhatamProposalDocument | null,
  companyResume: typeof COMPANY_RESUME_DATA = COMPANY_RESUME_DATA,
  documentMeta: typeof DOCUMENT_META = DOCUMENT_META,
  digitalUrl: string,
  digitalQrDataUrl: string,
  onProgress?: (msg: string) => void,
  filename?: string
): Promise<void> {
  onProgress?.('در حال بارگذاری فونت برداری قابل ویرایش (B Nazanin)...');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit as unknown as Parameters<PDFDocument['registerFontkit']>[0]);

  const baseUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : './';
  const fontRes = await fetch(`${baseUrl}assets/fonts/BNazaninBold.ttf`);
  if (!fontRes.ok) {
    throw new Error('Could not load BNazaninBold.ttf for vector PDF export.');
  }
  const bnazaninBytes = new Uint8Array(await fontRes.arrayBuffer());
  const mainFont = await pdfDoc.embedFont(bnazaninBytes, { subset: true });

  // Pre-warm full Persian + English + Numeric Unicode range so PDF editors
  // (Adobe Acrobat, Word, Foxit) have every character in the ToUnicode CMap!
  mainFont.encodeText(
    'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإةءًٌٍَُِّْ‌۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩' +
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
      '()[]{}-_–—.,،؛:!؟/%+*·▪•❖❑✓«»|@#&= '
  );

  let titleFont = mainFont;
  try {
    const titrRes = await fetch(`${baseUrl}assets/fonts/BTitrBold.ttf`);
    if (titrRes.ok) {
      const titrBytes = new Uint8Array(await titrRes.arrayBuffer());
      titleFont = await pdfDoc.embedFont(titrBytes, { subset: true });
      titleFont.encodeText(
        'آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإة‌۰۱۲۳۴۵۶۷۸۹abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()-.,: '
      );
    }
  } catch {
    titleFont = mainFont;
  }

  const fonts: LoadedFonts = { main: mainFont, boldTitle: titleFont };

  pdfDoc.setTitle(
    proposal
      ? `${proposal.coverMainTitle} — ${proposal.recipientShortOnCover}`
      : documentMeta.title
  );
  pdfDoc.setAuthor(documentMeta.instructorName);
  pdfDoc.setSubject(proposal ? proposal.subject : documentMeta.clientProject);
  pdfDoc.setCreator('OWJ Business Council Vector PDF Engine');
  pdfDoc.setProducer('pdf-lib + @pdf-lib/fontkit (Unicode B Nazanin)');

  onProgress?.('در حال بارگذاری تصاویر و لوگوهای سازمانی...');
  const imgCache = new Map<string, PDFImage | null>();
  const [
    owjWhite,
    ajaWhite,
    coverImg,
    contactStripImg,
    copyrightShieldImg,
    tocStripImg,
    instructorImg,
    qrImg,
    digitalQrImg,
    iranPmaImg,
    ipmaLogoImg,
    axelosImg,
    pmiLogoImg,
    certV7Img,
    certPmiImg,
    fakouriImg,
    aslaniImg,
    clientsImg,
    ipmaGridImg,
    closingStripImg,
    backMapImg,
  ] = await Promise.all([
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.owjLogoWhite, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.ajaLogoWhite, imgCache),
    loadImageForPdf(
      pdfDoc,
      proposal?.coverImage || EXTRACTED_ASSETS.coverFull,
      imgCache
    ),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.contactStrip, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.copyrightShieldClean, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.tocConstructionStrip, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.instructorCutout, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.qrCode, imgCache),
    loadImageForPdf(pdfDoc, digitalQrDataUrl, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.iranPmaClean, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.ipmaFullLogo, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.axelosLogo, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.pmiLogo, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.certCpmaiV7, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.certPmiCpmai, imgCache),
    loadImageForPdf(pdfDoc, SENIOR_COACHES_DATA[0].portrait, imgCache),
    loadImageForPdf(pdfDoc, SENIOR_COACHES_DATA[1].portrait, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.clientsLogosAndWorkshops, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.ipmaWorkshopsGrid, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.closingWorkshopStrip, imgCache),
    loadImageForPdf(pdfDoc, EXTRACTED_ASSETS.backCoverMap, imgCache),
  ]);

  const totalPagesStr = proposal ? TOTAL_PAGES_FA : '۵';
  const shortTitle = proposal
    ? proposal.recipientShortOnCover
    : documentMeta.clientProject;

  const createFramedPage = (
    pageNumFa: string,
    sectionLabel: string,
    showAjaLogo: boolean = true
  ): PDFPage => {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    // White base
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H,
      color: C_WHITE,
    });

    // Top Deep Teal-Navy Header Band
    page.drawRectangle({
      x: 0,
      y: PAGE_H - 50,
      width: PAGE_W,
      height: 50,
      color: C_NAVY,
    });
    // Sky-Cyan Stripe
    page.drawRectangle({
      x: 0,
      y: PAGE_H - 57,
      width: PAGE_W,
      height: 7,
      color: C_CYAN,
    });

    drawImageContain(page, owjWhite, PAGE_W - 105, PAGE_H - 42, 78, 34);
    addPageLinkAnnotation(
      pdfDoc,
      page,
      [PAGE_W - 108, PAGE_H - 46, PAGE_W - 22, PAGE_H - 6],
      `https://${documentMeta.website}`
    );

    if (showAjaLogo) {
      drawImageContain(page, ajaWhite, 26, PAGE_H - 40, 74, 30);
      drawBidiLine(
        page,
        fonts.main,
        `پروپوزال رسمی PMI-CPMAI v8 · ${shortTitle}`,
        {
          centerX: PAGE_W / 2,
          y: PAGE_H - 21,
          size: 8.5,
          color: C_SKY_LIGHT,
          align: 'center',
        }
      );
      drawBidiLine(
        page,
        fonts.main,
        `${sectionLabel} — صفحه ${pageNumFa} از ${totalPagesStr}`,
        {
          centerX: PAGE_W / 2,
          y: PAGE_H - 36,
          size: 9,
          color: C_WHITE,
          align: 'center',
        }
      );
    }

    // Bottom Navy Footer Bar
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: 28,
      color: C_NAVY,
    });

    // Left Cyan Angled Trapezoid Block
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 170,
      height: 36,
      color: C_CYAN,
    });
    // Diagonal white mask wedge look at right edge of cyan badge
    page.drawLine({
      start: { x: 170, y: 0 },
      end: { x: 148, y: 36 },
      thickness: 6,
      color: C_WHITE,
    });
    drawBidiLine(page, fonts.main, pageNumFa, {
      centerX: 74,
      y: 12,
      size: 14,
      color: C_WHITE,
      align: 'center',
    });

    drawBidiLine(
      page,
      fonts.main,
      `${documentMeta.organization}  ·  ${shortTitle}  ·  ${documentMeta.website}`,
      {
        xRight: PAGE_W - 24,
        y: 10,
        size: 8.5,
        color: C_WHITE,
        align: 'right',
      }
    );
    addPageLinkAnnotation(
      pdfDoc,
      page,
      [190, 2, PAGE_W - 20, 26],
      digitalUrl
    );

    return page;
  };

  const drawAccreditationBar = (page: PDFPage, yPos: number = 46) => {
    page.drawLine({
      start: { x: MARGIN_L, y: yPos + 38 },
      end: { x: CONTENT_X_RIGHT, y: yPos + 38 },
      thickness: 0.75,
      color: C_BORDER,
    });
    drawImageContain(page, pmiLogoImg, 44, yPos, 95, 32);
    drawImageContain(page, axelosImg, 175, yPos + 2, 95, 28);
    drawImageContain(page, ipmaLogoImg, 310, yPos, 110, 32);
    drawImageContain(page, iranPmaImg, 445, yPos, 110, 32);
  };

  const drawVectorTable = (
    page: PDFPage,
    startY: number,
    headers: string[],
    rows: string[][],
    colWidths: number[],
    opts?: { fontSize?: number; rowPadV?: number }
  ): number => {
    const fSize = opts?.fontSize ?? 9;
    const padV = opts?.rowPadV ?? 6;
    const lh = fSize * 1.42;
    let y = startY;

    const drawRow = (cells: string[], isHeader: boolean, rowIdx: number) => {
      const wrappedCols = cells.map((txt, cIdx) =>
        wrapBidiText(fonts.main, txt, fSize, colWidths[cIdx] - 10)
      );
      const maxLines = Math.max(...wrappedCols.map((w) => Math.max(w.length, 1)));
      const rowH = maxLines * lh + padV * 2;

      const bgColor = isHeader
        ? C_NAVY
        : rowIdx % 2 === 0
          ? C_CYAN_PALE
          : C_WHITE;

      let x = CONTENT_X_RIGHT;
      for (let c = 0; c < cells.length; c++) {
        const w = colWidths[c];
        const cellXLeft = x - w;
        page.drawRectangle({
          x: cellXLeft,
          y: y - rowH,
          width: w,
          height: rowH,
          color: bgColor,
          borderColor: C_BORDER,
          borderWidth: 0.5,
        });

        const cellLines = wrappedCols[c];
        let textY = y - padV - fSize;
        for (const ln of cellLines) {
          drawBidiLine(page, fonts.main, ln, {
            xRight: x - 6,
            centerX: cellXLeft + w / 2,
            y: textY,
            size: fSize,
            color: isHeader
              ? C_WHITE
              : c === 2
                ? C_CYAN_DARK
                : c === 0
                  ? C_INK
                  : C_SLATE,
            align: c === 0 || isHeader ? (c === 0 ? 'right' : 'center') : 'center',
          });
          textY -= lh;
        }
        x -= w;
      }
      y -= rowH;
    };

    drawRow(headers, true, -1);
    rows.forEach((r, idx) => drawRow(r, false, idx));
    return y;
  };

  // ==================== PAGE 1: COVER ====================
  onProgress?.('در حال ایجاد جلد و صفحات آغازین برداری...');
  {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    if (coverImg) {
      page.drawImage(coverImg, {
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
      });
    } else {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
        color: C_WHITE,
      });
    }

    const coverTitle = proposal
      ? proposal.coverMainTitle
      : documentMeta.title;
    const coverOrg = documentMeta.organization;
    const coverRecip = proposal
      ? proposal.recipientShortOnCover
      : documentMeta.clientProject;
    const coverSub = proposal
      ? `${proposal.tierBadge} · کد سند: ${proposal.letterNumber}`
      : documentMeta.instructorRole;

    drawBidiLine(page, fonts.boldTitle, coverTitle, {
      xRight: PAGE_W - 44,
      y: 212,
      size: 16.5,
      color: C_INK,
      align: 'right',
    });
    drawBidiLine(page, fonts.boldTitle, coverOrg, {
      xRight: PAGE_W - 44,
      y: 183,
      size: 21,
      color: C_INK,
      align: 'right',
    });

    page.drawLine({
      start: { x: 34, y: 170 },
      end: { x: PAGE_W - 34, y: 170 },
      thickness: 2,
      color: C_CYAN,
    });

    drawBidiLine(page, fonts.main, coverRecip, {
      xRight: PAGE_W - 34,
      y: 146,
      size: 15,
      color: C_CYAN,
      align: 'right',
    });
    drawBidiLine(page, fonts.main, coverSub, {
      xRight: PAGE_W - 34,
      y: 129,
      size: 8.5,
      color: C_SLATE,
      align: 'right',
    });

    // QR Code Card bottom-left of cover overlay
    if (digitalQrImg) {
      page.drawRectangle({
        x: 34,
        y: 96,
        width: 155,
        height: 48,
        color: C_WHITE,
        borderColor: C_CYAN,
        borderWidth: 0.9,
      });
      drawImageContain(page, digitalQrImg, 38, 100, 40, 40);
      drawBidiLine(
        page,
        fonts.main,
        proposal
          ? `نسخه دیجیتال پروپوزال ${proposal.proposalNum}`
          : 'نسخه دیجیتال آنلاین',
        {
          xRight: 183,
          y: 127,
          size: 7.5,
          color: C_NAVY,
          align: 'right',
        }
      );
      drawBidiLine(page, fonts.main, 'مشاهده آنلاین و نقشه راه', {
        xRight: 183,
        y: 111,
        size: 8,
        color: C_INK,
        align: 'right',
      });
      addPageLinkAnnotation(pdfDoc, page, [34, 96, 189, 144], digitalUrl);
    }

    drawImageContain(page, contactStripImg, 34, 24, PAGE_W - 68, 52);
    addPageLinkAnnotation(
      pdfDoc,
      page,
      [34, 24, PAGE_W - 34, 76],
      `https://${documentMeta.website}`
    );
  }

  // ==================== PAGE 2: FORMAL COVER LETTER ====================
  if (proposal) {
    const page = createFramedPage('۲', 'نامه رسمی معرفی پروپوزال', false);

    // Date & Letter No top-left
    drawBidiLine(page, fonts.main, `تاریخ: ${proposal.letterDate}`, {
      xLeft: MARGIN_L + 16,
      y: Y_TOP_START - 20,
      size: 11.5,
      color: C_INK,
      align: 'left',
    });
    drawBidiLine(page, fonts.main, `شماره نامه: ${proposal.letterNumber}`, {
      xLeft: MARGIN_L + 16,
      y: Y_TOP_START - 40,
      size: 11.5,
      color: C_INK,
      align: 'left',
    });
    drawBidiLine(page, fonts.main, 'پیوست: دارد', {
      xLeft: MARGIN_L + 16,
      y: Y_TOP_START - 60,
      size: 11.5,
      color: C_INK,
      align: 'left',
    });

    drawBidiLine(page, fonts.main, 'بسمه تعالی', {
      centerX: PAGE_W / 2,
      y: Y_TOP_START - 102,
      size: 14,
      color: C_INK,
      align: 'center',
    });

    let y = Y_TOP_START - 142;
    y = drawWrappedBidiParagraph(page, fonts.main, `به: ${proposal.recipientTitle}`, {
      xRight: CONTENT_X_RIGHT - 10,
      y,
      maxWidth: CONTENT_W - 20,
      size: 13,
      lineHeight: 24,
    }) - 6;

    y = drawWrappedBidiParagraph(page, fonts.main, `از: ${proposal.senderTitle}`, {
      xRight: CONTENT_X_RIGHT - 10,
      y,
      maxWidth: CONTENT_W - 20,
      size: 12.5,
      lineHeight: 23,
    }) - 6;

    y = drawWrappedBidiParagraph(page, fonts.main, `موضوع: ${proposal.subject}`, {
      xRight: CONTENT_X_RIGHT - 10,
      y,
      maxWidth: CONTENT_W - 20,
      size: 12.5,
      lineHeight: 23,
    }) - 14;

    drawBidiLine(page, fonts.main, 'با سلام', {
      xRight: CONTENT_X_RIGHT - 10,
      y,
      size: 13,
      color: C_INK,
      align: 'right',
    });
    y -= 26;

    y = drawWrappedBidiParagraph(
      page,
      fonts.main,
      `احتراماً، ${proposal.executiveLead}`,
      {
        xRight: CONTENT_X_RIGHT - 10,
        y,
        maxWidth: CONTENT_W - 20,
        size: 12.5,
        lineHeight: 24,
      }
    );

    const sigY = Math.max(y - 36, 150);
    drawBidiLine(page, fonts.main, 'با تقدیم احترام', {
      centerX: 165,
      y: sigY,
      size: 12,
      color: C_INK,
      align: 'center',
    });
    drawBidiLine(page, fonts.boldTitle, documentMeta.instructorName, {
      centerX: 165,
      y: sigY - 24,
      size: 15,
      color: C_INK,
      align: 'center',
    });
    drawBidiLine(page, fonts.main, documentMeta.instructorRole, {
      centerX: 165,
      y: sigY - 46,
      size: 11.5,
      color: C_SLATE,
      align: 'center',
    });
  }

  // ==================== PAGE 3: TITLE & COPYRIGHT NOTICE ====================
  if (proposal) {
    const page = createFramedPage(
      '۳',
      'عنوان سند و صیانت از حقوق مالکیت معنوی'
    );
    let y = Y_TOP_START - 75;
    y = drawWrappedBidiParagraph(page, fonts.boldTitle, proposal.coverMainTitle, {
      xRight: CONTENT_X_RIGHT,
      centerX: PAGE_W / 2,
      y,
      maxWidth: CONTENT_W,
      size: 20,
      lineHeight: 30,
      align: 'center',
    });
    drawBidiLine(page, fonts.main, '(PMI-CPMAI v8)', {
      centerX: PAGE_W / 2,
      y: y - 8,
      size: 18,
      align: 'center',
    });

    y -= 48;
    y = drawWrappedBidiParagraph(page, fonts.main, proposal.tierBadge, {
      xRight: CONTENT_X_RIGHT,
      centerX: PAGE_W / 2,
      y,
      maxWidth: CONTENT_W,
      size: 16,
      lineHeight: 24,
      color: C_CYAN_DARK,
      align: 'center',
    });
    drawWrappedBidiParagraph(page, fonts.main, proposal.recipientShortOnCover, {
      xRight: CONTENT_X_RIGHT,
      centerX: PAGE_W / 2,
      y: y - 4,
      maxWidth: CONTENT_W,
      size: 17,
      lineHeight: 26,
      color: C_CYAN_DARK,
      align: 'center',
    });

    drawImageContain(page, copyrightShieldImg, PAGE_W / 2 - 55, 290, 110, 110);

    drawWrappedBidiParagraph(page, fonts.main, companyResume.copyrightStatement, {
      xRight: CONTENT_X_RIGHT - 30,
      centerX: PAGE_W / 2,
      y: 255,
      maxWidth: CONTENT_W - 60,
      size: 11,
      lineHeight: 21,
      color: C_INK,
      align: 'center',
    });
  }

  // ==================== PAGE 4: TABLE OF CONTENTS ====================
  if (proposal) {
    const page = createFramedPage('۴', 'فهرست مطالب');

    drawBidiLine(page, fonts.boldTitle, 'فهرست', {
      centerX: PAGE_W / 2,
      y: Y_TOP_START - 22,
      size: 21,
      align: 'center',
    });

    const tocEntries = [
      { label: 'فهرست', page: '۴' },
      { label: 'درباره تیم اوج، مجریان و راهبران', page: '۵' },
      {
        label: 'معرفی کوچ‌های ارشد دوره (کاظم فکوری‌زاد و امیر اصلانی)',
        page: '۷',
      },
      { label: 'درباره شرکت اوج و کارنامه مشتریان', page: '۹' },
      { label: 'خلاصه سرفصل‌های دوره (فصول ۱ تا ۵)', page: '۱۱' },
      { label: 'پروتکل اجرایی سالن و زمان‌بندی روزانه کارگاه', page: '۲۰' },
      { label: 'مدت زمان کل دوره', page: '۲۱' },
      { label: 'حق‌الزحمه پیشنهادی', page: '۲۱' },
      { label: 'تعداد نفرات حاضر در دوره', page: '۲۱' },
      { label: 'مدارک شرکت در دوره', page: '۲۱' },
    ];

    let y = Y_TOP_START - 68;
    for (const entry of tocEntries) {
      const labelW = measureBidiLineWidth(fonts.main, entry.label, 12.5);
      const pgW = measureBidiLineWidth(fonts.main, entry.page, 12.5);
      drawBidiLine(page, fonts.main, entry.label, {
        xRight: CONTENT_X_RIGHT - 22,
        y,
        size: 12.5,
        align: 'right',
      });
      drawBidiLine(page, fonts.main, entry.page, {
        xLeft: MARGIN_L + 22,
        y,
        size: 12.5,
        align: 'left',
      });
      const dotStart = MARGIN_L + 22 + pgW + 10;
      const dotEnd = CONTENT_X_RIGHT - 22 - labelW - 10;
      if (dotEnd > dotStart + 8) {
        page.drawLine({
          start: { x: dotStart, y: y + 3 },
          end: { x: dotEnd, y: y + 3 },
          thickness: 0.9,
          dashArray: [2, 3],
          color: C_MUTED,
        });
      }
      y -= 31;
    }

    drawImageContain(page, tocStripImg, 0, 28, PAGE_W, 195);
  }

  // ==================== PAGE 5 (OR 2): INSTRUCTOR PART 1 ====================
  onProgress?.('در حال ایجاد اسناد رزومه مدرس و کوچ‌های ارشد...');
  {
    const pNum = proposal ? '۵' : '۲';
    const page = createFramedPage(
      pNum,
      'درباره تیم اوج، مجریان و راهبران: مدرس دوره'
    );

    drawImageContain(page, instructorImg, MARGIN_L, 535, 190, 225, true);
    drawImageContain(page, qrImg, 360, 560, 82, 82);

    drawBidiLine(page, fonts.main, 'مدرس دوره:', {
      xRight: CONTENT_X_RIGHT,
      y: Y_TOP_START - 10,
      size: 12.5,
      color: C_INK,
      align: 'right',
    });
    drawBidiLine(page, fonts.boldTitle, documentMeta.instructorName, {
      xRight: CONTENT_X_RIGHT,
      y: Y_TOP_START - 42,
      size: 24,
      color: C_INK,
      align: 'right',
    });
    drawBidiLine(page, fonts.main, documentMeta.instructorRole, {
      xRight: CONTENT_X_RIGHT,
      y: Y_TOP_START - 68,
      size: 12.5,
      color: C_INK,
      align: 'right',
    });

    let y = 515;
    y =
      drawBidiBullet(page, fonts.main, '•', documentMeta.instructorDistinction, {
        xRight: CONTENT_X_RIGHT,
        y,
        maxWidth: CONTENT_W,
        size: 11,
        lineHeight: 17.5,
        color: C_CYAN_DARK,
      }) - 8;

    for (const cred of PM_CREDENTIALS) {
      y = drawBidiBullet(page, fonts.main, '•', cred.titleFa, {
        xRight: CONTENT_X_RIGHT,
        y,
        maxWidth: CONTENT_W,
        size: 10.2,
        lineHeight: 16,
        color: C_INK,
      }) - 4;
    }

    drawAccreditationBar(page, 46);
  }

  // ==================== PAGE 6 (OR 3): INSTRUCTOR PART 2 (13 AI CREDS + CERTS) ====================
  {
    const pNum = proposal ? '۶' : '۳';
    const page = createFramedPage(
      pNum,
      'گواهینامه‌های ۱۳گانه هوش مصنوعی و تاییدیه‌های PMI'
    );

    drawBidiLine(page, fonts.boldTitle, documentMeta.instructorName, {
      centerX: PAGE_W / 2,
      y: Y_TOP_START - 10,
      size: 19,
      align: 'center',
    });
    let y = drawWrappedBidiParagraph(
      page,
      fonts.main,
      'اولین و تنها ایرانی دارنده تمامی گواهینامه‌های هوش مصنوعی Cognilytica آمریکا و انیستیتو مدیریت پروژه آمریکا (PMI) (CPMAI v7) (PMI-CPMAI)',
      {
        xRight: CONTENT_X_RIGHT - 20,
        centerX: PAGE_W / 2,
        y: Y_TOP_START - 34,
        maxWidth: CONTENT_W - 40,
        size: 10.8,
        lineHeight: 17,
        align: 'center',
      }
    );

    y -= 10;
    for (const item of AI_CREDENTIALS_13) {
      y =
        drawBidiBullet(page, fonts.main, '•', item.titleFa, {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 9.8,
          lineHeight: 15.2,
          color: C_INK,
        }) - 3;
    }

    drawImageContain(page, certV7Img, MARGIN_L, 52, 250, 165);
    drawImageContain(page, certPmiImg, MARGIN_L + 266, 52, 250, 165);
  }

  // ==================== PAGE 7 & 8: SENIOR COACHES ====================
  if (proposal) {
    // PAGE 7: KAZEM FAKOURIZAD
    {
      const coach = SENIOR_COACHES_DATA[0];
      const page = createFramedPage('۷', `کوچ‌های ارشد دوره: ${coach.name}`);

      drawImageContain(page, fakouriImg, MARGIN_L, 505, 195, 240, true);
      page.drawLine({
        start: { x: MARGIN_L, y: 505 },
        end: { x: CONTENT_X_RIGHT, y: 505 },
        thickness: 1.2,
        color: C_INK,
      });

      drawBidiLine(page, fonts.main, 'کوچ‌های ارشد دوره:', {
        xRight: CONTENT_X_RIGHT,
        y: Y_TOP_START - 4,
        size: 12,
      });
      drawBidiLine(page, fonts.boldTitle, coach.name, {
        xRight: CONTENT_X_RIGHT,
        y: Y_TOP_START - 34,
        size: 21,
      });
      let y = drawWrappedBidiParagraph(page, fonts.main, coach.roleTitle, {
        xRight: CONTENT_X_RIGHT,
        y: Y_TOP_START - 56,
        maxWidth: 310,
        size: 10,
        lineHeight: 15,
      });
      y -= 4;

      for (const exp of coach.experiences) {
        y =
          drawBidiBullet(page, fonts.main, '•', exp, {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: 312,
            size: 9.4,
            lineHeight: 14.5,
          }) - 3;
      }

      let bodyY = 480;
      drawBidiLine(page, fonts.boldTitle, coach.skillsTitle, {
        xRight: CONTENT_X_RIGHT,
        y: bodyY,
        size: 11.5,
      });
      bodyY -= 20;
      for (const sk of coach.skills) {
        bodyY =
          drawWrappedBidiParagraph(
            page,
            fonts.main,
            `${sk.category}: ${sk.items}`,
            {
              xRight: CONTENT_X_RIGHT,
              y: bodyY,
              maxWidth: CONTENT_W,
              size: 10,
              lineHeight: 16,
            }
          ) - 4;
      }

      if (coach.certificates && coach.certificatesTitle) {
        bodyY -= 8;
        drawBidiLine(page, fonts.boldTitle, coach.certificatesTitle, {
          xRight: CONTENT_X_RIGHT,
          y: bodyY,
          size: 11.5,
        });
        bodyY -= 20;
        for (const cert of coach.certificates) {
          bodyY =
            drawWrappedBidiParagraph(page, fonts.main, cert, {
              xRight: CONTENT_X_RIGHT,
              y: bodyY,
              maxWidth: CONTENT_W,
              size: 10,
              lineHeight: 16,
            }) - 3;
        }
      }

      drawAccreditationBar(page, 46);
    }

    // PAGE 8: AMIR ASLANI
    {
      const coach = SENIOR_COACHES_DATA[1];
      const page = createFramedPage('۸', `کوچ‌های ارشد دوره: ${coach.name}`);

      drawImageContain(page, aslaniImg, MARGIN_L, 505, 195, 240, true);
      page.drawLine({
        start: { x: MARGIN_L, y: 505 },
        end: { x: CONTENT_X_RIGHT, y: 505 },
        thickness: 1.2,
        color: C_INK,
      });

      drawBidiLine(page, fonts.main, 'کوچ‌های ارشد دوره:', {
        xRight: CONTENT_X_RIGHT,
        y: Y_TOP_START - 4,
        size: 12,
      });
      drawBidiLine(page, fonts.boldTitle, coach.name, {
        xRight: CONTENT_X_RIGHT,
        y: Y_TOP_START - 34,
        size: 21,
      });
      let y = drawWrappedBidiParagraph(page, fonts.main, coach.roleTitle, {
        xRight: CONTENT_X_RIGHT,
        y: Y_TOP_START - 56,
        maxWidth: 310,
        size: 10.5,
        lineHeight: 16,
      });
      y -= 6;

      for (const exp of coach.experiences) {
        y =
          drawBidiBullet(page, fonts.main, '•', exp, {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: 312,
            size: 10.2,
            lineHeight: 16.5,
          }) - 6;
      }

      let bodyY = 475;
      drawBidiLine(page, fonts.boldTitle, coach.skillsTitle, {
        xRight: CONTENT_X_RIGHT,
        y: bodyY,
        size: 12.5,
      });
      bodyY -= 24;
      for (const sk of coach.skills) {
        bodyY =
          drawWrappedBidiParagraph(
            page,
            fonts.main,
            `${sk.category}: ${sk.items}`,
            {
              xRight: CONTENT_X_RIGHT,
              y: bodyY,
              maxWidth: CONTENT_W,
              size: 11,
              lineHeight: 18.5,
            }
          ) - 10;
      }

      drawAccreditationBar(page, 46);
    }

    // PAGE 9: ABOUT OWJ & CLIENT LOGOS
    {
      const page = createFramedPage('۹', 'درباره شرکت اوج و کارنامه مشتریان');
      let y = Y_TOP_START;
      y =
        drawBidiBullet(page, fonts.main, '•', companyResume.executiveIntro, {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 9.8,
          lineHeight: 15.8,
        }) - 6;
      y =
        drawBidiBullet(page, fonts.main, '•', companyResume.clientsSummary, {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 9.8,
          lineHeight: 15.8,
        }) - 10;

      const imgH = Math.max(y - 52, 320);
      drawImageContain(page, clientsImg, MARGIN_L, 52, CONTENT_W, imgH);
    }

    // PAGE 10: IPMA PRIDE & WORKSHOPS GRID
    {
      const page = createFramedPage(
        '۱۰',
        'کارنامه ملی گواهینامه‌های IPMA و کارگاه‌های جامع'
      );
      const y = drawBidiBullet(
        page,
        fonts.main,
        '•',
        companyResume.ipmaPrideStatement,
        {
          xRight: CONTENT_X_RIGHT,
          y: Y_TOP_START,
          maxWidth: CONTENT_W,
          size: 11.5,
          lineHeight: 18.5,
        }
      );
      const imgH = Math.max(y - 54, 420);
      drawImageContain(page, ipmaGridImg, MARGIN_L, 54, CONTENT_W, imgH);
    }

    // ==================== CHAPTERS 1-6 FOR KHATAM PROPOSAL ====================
    onProgress?.('در حال نگارش برداری فصول یک تا شش پروپوزال...');

    // PAGE 11: CHAPTER 1 PART 1
    {
      const page = createFramedPage(
        '۱۱',
        'خلاصه سرفصل‌های دوره · فصل اول (شناخت راهبردی هلدینگ)'
      );
      let y = Y_TOP_START;
      drawBidiLine(page, fonts.boldTitle, 'خلاصه سرفصل‌های دوره:', {
        xRight: CONTENT_X_RIGHT,
        y,
        size: 15.5,
      });
      y -= 24;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'فصل اول (شناخت راهبردی هلدینگ)',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 13,
          badgeColor: C_NAVY,
        }
      );
      y -= 20;
      y =
        drawBidiBullet(
          page,
          fonts.main,
          '•',
          `${proposal.strategicContextTitle}:`,
          {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: CONTENT_W,
            size: 11,
            lineHeight: 17,
            bulletColor: C_CYAN_DARK,
          }
        ) - 4;

      y =
        drawWrappedBidiParagraph(page, fonts.main, proposal.strategicContextLead, {
          xRight: CONTENT_X_RIGHT - 12,
          y,
          maxWidth: CONTENT_W - 12,
          size: 10.2,
          lineHeight: 16.8,
        }) - 10;

      drawBidiLine(
        page,
        fonts.boldTitle,
        'محورهای تخصصی و حوزه‌های راهبردی مورد تمرکز در مثال‌ها و تمرینات این دوره:',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11,
        }
      );
      y -= 18;

      for (const dom of proposal.keyEntitiesAndSites) {
        y =
          drawBidiBullet(page, fonts.main, '•', dom, {
            xRight: CONTENT_X_RIGHT - 8,
            y,
            maxWidth: CONTENT_W - 8,
            size: 10.2,
            lineHeight: 16,
          }) - 3;
      }

      y -= 8;
      page.drawLine({
        start: { x: MARGIN_L, y: y + 6 },
        end: { x: CONTENT_X_RIGHT, y: y + 6 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 10;

      if (proposal.cascadeGovernance) {
        drawAccentHeading(
          page,
          fonts.boldTitle,
          'معماری آبشاری ۳ سطحی استقرار استاندارد PMI-CPMAI v8 در قرارگاه (هر سطح ۹۶ ساعت):',
          {
            xRight: CONTENT_X_RIGHT,
            y,
            size: 10.8,
            color: C_CYAN_DARK,
            badgeColor: C_CYAN_DARK,
          }
        );
        y -= 18;
        for (const t of proposal.cascadeGovernance.tiers) {
          y =
            drawBidiBullet(
              page,
              fonts.main,
              '•',
              `${t.level} (${t.duration}): ${t.outcome}`,
              {
                xRight: CONTENT_X_RIGHT - 6,
                y,
                maxWidth: CONTENT_W - 6,
                size: 9.8,
                lineHeight: 15.2,
                bulletColor: C_CYAN_DARK,
              }
            ) - 4;
        }
      } else {
        drawAccentHeading(
          page,
          fonts.boldTitle,
          '۴ مزیت اختصاصی پیاده‌سازی آموزشی استاندارد PMI-CPMAI v8 برای مدیران و کارشناسان:',
          {
            xRight: CONTENT_X_RIGHT,
            y,
            size: 10.8,
            color: C_CYAN_DARK,
            badgeColor: C_CYAN_DARK,
          }
        );
        y -= 18;
        for (const p of companyResume.whyOwjForCpmai) {
          y =
            drawBidiBullet(
              page,
              fonts.main,
              '•',
              `${p.title}: ${p.description}`,
              {
                xRight: CONTENT_X_RIGHT - 6,
                y,
                maxWidth: CONTENT_W - 6,
                size: 9.8,
                lineHeight: 15.2,
                bulletColor: C_CYAN_DARK,
              }
            ) - 4;
        }
      }
    }

    // PAGE 12: CHAPTER 1 PART 2 — STRATEGIC CHALLENGES
    {
      const page = createFramedPage(
        '۱۲',
        'فصل اول (ادامه): چالش‌های راهبردی هلدینگ'
      );
      let y = Y_TOP_START;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'چالش‌های راهبردی هلدینگ و ضرورت آموزش PMI-CPMAI v8',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 14,
          badgeColor: C_NAVY,
        }
      );
      y -= 20;
      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          'گلوگاه‌های کلیدی که آموزش و فرهنگ‌سازی استاندارد جهانی مدیریت پروژه‌های هوش مصنوعی (CPMAI) مستقیماً به حل آن‌ها کمک می‌کند:',
          {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: CONTENT_W,
            size: 10.8,
            lineHeight: 17,
          }
        ) - 12;

      for (const ch of proposal.challenges) {
        const blockTop = y;
        drawBidiLine(page, fonts.boldTitle, `${ch.num}. ${ch.title}`, {
          xRight: CONTENT_X_RIGHT - 10,
          y,
          size: 11.8,
          color: C_INK,
        });
        y -= 18;
        y = drawWrappedBidiParagraph(page, fonts.main, ch.description, {
          xRight: CONTENT_X_RIGHT - 10,
          y,
          maxWidth: CONTENT_W - 14,
          size: 10.4,
          lineHeight: 17,
          color: C_SLATE,
        });
        page.drawLine({
          start: { x: CONTENT_X_RIGHT - 2, y: blockTop + 10 },
          end: { x: CONTENT_X_RIGHT - 2, y: y + 8 },
          thickness: 2.2,
          color: C_CYAN,
        });
        y -= 12;
      }

      y -= 6;
      page.drawLine({
        start: { x: MARGIN_L, y: y + 8 },
        end: { x: CONTENT_X_RIGHT, y: y + 8 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 10;
      drawWrappedBidiParagraph(
        page,
        fonts.main,
        '• نتیجه‌گیری راهبردی: عبور از این چالش‌ها نیازمند خرید عجولانه نرم‌افزار نیست؛ بلکه در گام نخست نیازمند آموزش، فرهنگ‌سازی و ایجاد زبان مشترک PMI-CPMAI v8 در میان مدیران و کارشناسان کلیدی هلدینگ است.',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 10.6,
          lineHeight: 17,
          color: C_NAVY,
        }
      );
    }

    // PAGE 13: CHAPTER 2 — ALL 7 AI PATTERNS
    {
      const page = createFramedPage(
        '۱۳',
        'فصل دوم: نگاشت یکپارچه الگوهای هفت‌گانه هوش مصنوعی (۱ تا ۷)'
      );
      let y = Y_TOP_START;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'فصل دوم (نگاشت الگوهای هفت‌گانه هوش مصنوعی PMI-CPMAI Seven Patterns)',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 13.5,
          badgeColor: C_NAVY,
        }
      );
      y -= 20;
      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          'طبق استاندارد جهانی PMI-CPMAI، تمامی پروژه‌های هوش مصنوعی جهان در ۷ الگوی بنیادین دسته‌بندی می‌شوند. در این کارگاه نحوه کاربست هر ۷ الگو در مسائل واقعی هلدینگ تمرین می‌شود:',
          {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: CONTENT_W,
            size: 10.2,
            lineHeight: 16,
          }
        ) - 10;

      for (const pat of proposal.aiPatterns) {
        const top = y;
        drawBidiLine(
          page,
          fonts.boldTitle,
          `• ${pat.num}: ${pat.titleFa}`,
          {
            xRight: CONTENT_X_RIGHT - 8,
            y,
            size: 11,
            color: C_INK,
          }
        );
        drawBidiLine(page, fonts.main, pat.titleEn, {
          xLeft: MARGIN_L,
          y,
          size: 9,
          color: C_CYAN_DARK,
          align: 'left',
        });
        y -= 16;
        y = drawWrappedBidiParagraph(page, fonts.main, pat.description, {
          xRight: CONTENT_X_RIGHT - 14,
          y,
          maxWidth: CONTENT_W - 18,
          size: 9.8,
          lineHeight: 15.2,
          color: C_SLATE,
        });
        page.drawLine({
          start: { x: CONTENT_X_RIGHT - 2, y: top + 8 },
          end: { x: CONTENT_X_RIGHT - 2, y: y + 8 },
          thickness: 1.5,
          color: C_CYAN,
        });
        y -= 8;
      }
    }

    // PAGE 14: HEURISTIC VS AI + VECTOR KPI TABLE + ROI & GO/NO-GO
    {
      const page = createFramedPage(
        '۱۴',
        'شاخص‌های کلیدی عملکرد (KPI)، تحلیل بازگشت سرمایه و امکان‌سنجی'
      );
      let y = Y_TOP_START;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'تفاوت رویکرد شناختی (CPMAI) در برابر روش‌های سنتی و فرمول‌های ایستا:',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11.5,
          color: C_NAVY,
          badgeColor: C_CYAN_DARK,
        }
      );
      y -= 18;
      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          proposal.roiAnalysis.heuristicComparison,
          {
            xRight: CONTENT_X_RIGHT - 10,
            y,
            maxWidth: CONTENT_W - 10,
            size: 10,
            lineHeight: 16,
          }
        ) - 10;

      page.drawLine({
        start: { x: MARGIN_L, y: y + 6 },
        end: { x: CONTENT_X_RIGHT, y: y + 6 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 10;

      drawBidiLine(
        page,
        fonts.boldTitle,
        'جدول شاخص‌های کلیدی عملکردی کسب‌وکار (Baseline vs. Target):',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11.5,
        }
      );
      y -= 12;

      y =
        drawVectorTable(
          page,
          y,
          [
            'شاخص کلیدی عملکرد (KPI)',
            'وضعیت فعلی (Baseline)',
            'هدف‌گذاری (Target)',
            'واحد سنجش',
          ],
          proposal.kpis.map((k) => [k.kpi, k.baseline, k.target, k.unit]),
          [205, 110, 110, 98.28],
          { fontSize: 9.2, rowPadV: 6 }
        ) - 16;

      drawAccentHeading(
        page,
        fonts.boldTitle,
        'تحلیل بازگشت سرمایه (ROI) و ممیزی ۹گانه امکان‌سنجی (AI Go / No-Go):',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11.2,
          color: C_NAVY,
          badgeColor: C_NAVY,
        }
      );
      y -= 17;
      drawBidiLine(
        page,
        fonts.main,
        `• حق‌الزحمه تدریس: ${proposal.roiAnalysis.budgetFormatted}`,
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 9.8,
          color: C_CYAN_DARK,
        }
      );
      y -= 18;

      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          `• برآورد منافع و صرفه‌جویی مستقیم سالانه: ${proposal.roiAnalysis.annualSavings}`,
          {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: CONTENT_W,
            size: 10,
            lineHeight: 16,
          }
        ) - 6;
      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          `• منافع استراتژیک و فرهنگی برای هلدینگ: ${proposal.roiAnalysis.intangibleBenefits}`,
          {
            xRight: CONTENT_X_RIGHT,
            y,
            maxWidth: CONTENT_W,
            size: 10,
            lineHeight: 16,
          }
        ) - 6;
      drawWrappedBidiParagraph(
        page,
        fonts.main,
        `• جمع‌بندی ممیزی ۹ پرسش امکان‌سنجی (AI Go / No-Go): ${proposal.roiAnalysis.goNoGoSummary}`,
        {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 10,
          lineHeight: 16,
          color: C_NAVY,
        }
      );
    }

    // Helper for Chapter 3 phase pairs (Pages 15 & 16)
    const renderPhasesPage = (
      pNum: string,
      label: string,
      heading: string,
      intro: string,
      phases: typeof proposal.cpmaiPhases,
      footerNote: string,
      footerEn: string
    ) => {
      const page = createFramedPage(pNum, label);
      let y = Y_TOP_START;
      drawAccentHeading(page, fonts.boldTitle, heading, {
        xRight: CONTENT_X_RIGHT,
        y,
        size: 13.5,
        badgeColor: C_NAVY,
      });
      y -= 20;
      y =
        drawWrappedBidiParagraph(page, fonts.main, intro, {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 10.2,
          lineHeight: 16,
        }) - 12;

      for (const ph of phases) {
        const top = y;
        drawBidiLine(
          page,
          fonts.boldTitle,
          `${ph.phaseNum}: ${ph.titleFa}`,
          {
            xRight: CONTENT_X_RIGHT - 10,
            y,
            size: 12,
            color: C_NAVY,
          }
        );
        drawBidiLine(page, fonts.main, ph.titleEn, {
          xLeft: MARGIN_L,
          y,
          size: 9,
          color: C_CYAN_DARK,
          align: 'left',
        });
        y -= 17;
        y =
          drawWrappedBidiParagraph(page, fonts.main, `هدف فاز: ${ph.summary}`, {
            xRight: CONTENT_X_RIGHT - 10,
            y,
            maxWidth: CONTENT_W - 14,
            size: 10,
            lineHeight: 15.8,
          }) - 4;
        for (const b of ph.bullets) {
          y =
            drawBidiBullet(page, fonts.main, '•', b, {
              xRight: CONTENT_X_RIGHT - 14,
              y,
              maxWidth: CONTENT_W - 18,
              size: 9.8,
              lineHeight: 15.2,
              color: C_SLATE,
              bulletColor: C_CYAN_DARK,
            }) - 3;
        }
        y =
          drawWrappedBidiParagraph(
            page,
            fonts.main,
            `• خروجی تمرینی فاز در کارگاه: ${ph.deliverable}`,
            {
              xRight: CONTENT_X_RIGHT - 10,
              y,
              maxWidth: CONTENT_W - 14,
              size: 9.8,
              lineHeight: 15,
              color: C_CYAN_DARK,
            }
          ) - 4;
        page.drawLine({
          start: { x: CONTENT_X_RIGHT - 2, y: top + 10 },
          end: { x: CONTENT_X_RIGHT - 2, y: y + 8 },
          thickness: 2,
          color: C_NAVY,
        });
        y -= 12;
      }

      page.drawLine({
        start: { x: MARGIN_L, y: y + 8 },
        end: { x: CONTENT_X_RIGHT, y: y + 8 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 10;
      drawBidiLine(page, fonts.main, footerNote, {
        xRight: CONTENT_X_RIGHT,
        y,
        size: 9.5,
        color: C_NAVY,
      });
      drawBidiLine(page, fonts.main, footerEn, {
        xLeft: MARGIN_L,
        y,
        size: 9,
        color: C_MUTED,
        align: 'left',
      });
    };

    // PAGE 15: PHASES I & II
    renderPhasesPage(
      '۱۵',
      'فصل سوم: کاربرگ آموزشی متدولوژی PMI-CPMAI v8 (Phases I & II)',
      'فصل سوم (کاربرگ آموزشی متدولوژی PMI-CPMAI v8 - Phases I & II)',
      'در طول دوره ۹۶ ساعته، شرکت‌کنندگان گام‌به‌گام کاربرگ‌های ۶ فاز استاندارد PMI-CPMAI v8 را بر روی مسائل و داده‌های نمونه آموزشی هلدینگ تکمیل می‌نمایند:',
      proposal.cpmaiPhases.slice(0, 2),
      'خروجی فازهای اول و دوم مبنای تصمیم‌گیری مدیریتی (Go / No-Go) پیش از ورود به فاز داده است.',
      'Phases I & II'
    );

    // PAGE 16: PHASES III & IV
    renderPhasesPage(
      '۱۶',
      'فصل سوم (ادامه): کاربرگ آموزشی (Phases III & IV)',
      'ادامه کاربرگ آموزشی متدولوژی PMI-CPMAI v8 - Phases III & IV',
      'تمرین عملی آماده‌سازی داده‌ها و ساخت مدل‌های شناختی با استفاده از ابزارهای آموزشی تعاملی و ابری (بدون نیاز به کدنویسی):',
      proposal.cpmaiPhases.slice(2, 4),
      'فازهای پنجم و ششم به همراه چک‌لیست ارزیابی دستاوردهای دوره در صفحه بعد ارائه شده‌اند.',
      'Phases III & IV'
    );

    // PAGE 17: PHASES V & VI + CHECKLIST
    {
      const page = createFramedPage(
        '۱۷',
        'فصل سوم (بخش پایانی): Phases V & VI و چک‌لیست ارزیابی'
      );
      let y = Y_TOP_START;
      for (const ph of proposal.cpmaiPhases.slice(4, 6)) {
        const top = y;
        drawBidiLine(
          page,
          fonts.boldTitle,
          `${ph.phaseNum}: ${ph.titleFa}`,
          {
            xRight: CONTENT_X_RIGHT - 10,
            y,
            size: 11.5,
            color: C_NAVY,
          }
        );
        drawBidiLine(page, fonts.main, ph.titleEn, {
          xLeft: MARGIN_L,
          y,
          size: 9,
          color: C_CYAN_DARK,
          align: 'left',
        });
        y -= 16;
        y =
          drawWrappedBidiParagraph(page, fonts.main, `هدف فاز: ${ph.summary}`, {
            xRight: CONTENT_X_RIGHT - 10,
            y,
            maxWidth: CONTENT_W - 14,
            size: 9.8,
            lineHeight: 15,
          }) - 3;
        for (const b of ph.bullets) {
          y =
            drawBidiBullet(page, fonts.main, '•', b, {
              xRight: CONTENT_X_RIGHT - 14,
              y,
              maxWidth: CONTENT_W - 18,
              size: 9.5,
              lineHeight: 14.5,
              color: C_SLATE,
              bulletColor: C_CYAN_DARK,
            }) - 2.5;
        }
        y =
          drawWrappedBidiParagraph(
            page,
            fonts.main,
            `• خروجی تمرینی فاز: ${ph.deliverable}`,
            {
              xRight: CONTENT_X_RIGHT - 10,
              y,
              maxWidth: CONTENT_W - 14,
              size: 9.5,
              lineHeight: 14.5,
              color: C_CYAN_DARK,
            }
          ) - 4;
        page.drawLine({
          start: { x: CONTENT_X_RIGHT - 2, y: top + 8 },
          end: { x: CONTENT_X_RIGHT - 2, y: y + 8 },
          thickness: 2,
          color: C_NAVY,
        });
        y -= 10;
      }

      page.drawLine({
        start: { x: MARGIN_L, y: y + 6 },
        end: { x: CONTENT_X_RIGHT, y: y + 6 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 12;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'چک‌لیست ارزیابی دستاوردهای آموزشی و تکمیل کاربرگ‌های دوره (CPMAI Readiness Checklist):',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 10.8,
          color: C_NAVY,
          badgeColor: C_CYAN_DARK,
        }
      );
      y -= 18;
      for (const item of proposal.signOffChecklist) {
        y =
          drawBidiBullet(page, fonts.main, '•', item, {
            xRight: CONTENT_X_RIGHT - 6,
            y,
            maxWidth: CONTENT_W - 6,
            size: 9.8,
            lineHeight: 15.2,
            bulletColor: C_CYAN_DARK,
          }) - 3;
      }
    }

    // PAGE 18: CHAPTER 4 — ORGANIZATIONAL CULTURE, TOOLS & READINESS
    {
      const page = createFramedPage(
        '۱۸',
        'فصل چهارم: فرهنگ‌سازی سازمانی، ابزارهای آموزشی و آمادگی پیش از کارگاه'
      );
      let y = Y_TOP_START;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'فصل چهارم (فرهنگ‌سازی سازمانی، ایجاد انگیزه تیمی و محیط ابزارهای آموزشی)',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 13.5,
          badgeColor: C_NAVY,
        }
      );
      y -= 22;
      y =
        drawWrappedBidiParagraph(page, fonts.main, proposal.airGappedNote, {
          xRight: CONTENT_X_RIGHT,
          y,
          maxWidth: CONTENT_W,
          size: 10.4,
          lineHeight: 17,
        }) - 10;

      drawBidiLine(
        page,
        fonts.boldTitle,
        'زیست‌بوم ابزارهای آموزشی مورد استفاده در کارگاه (بر روی داده‌های نمونه آموزشی):',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11,
        }
      );
      y -= 18;
      for (const tool of proposal.airGappedTools) {
        y =
          drawBidiBullet(page, fonts.main, '•', tool, {
            xRight: CONTENT_X_RIGHT - 8,
            y,
            maxWidth: CONTENT_W - 8,
            size: 10.2,
            lineHeight: 16.5,
          }) - 4;
      }

      y -= 8;
      page.drawLine({
        start: { x: MARGIN_L, y: y + 6 },
        end: { x: CONTENT_X_RIGHT, y: y + 6 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 12;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        'تمایز رقابتی و شفاف‌سازی مرز تعهدات فاز آموزش:',
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11,
          color: C_NAVY,
          badgeColor: C_NAVY,
        }
      );
      y -= 18;
      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          'هدف محوری این پروپوزال، آموزش استاندارد جهانی PMI-CPMAI v8، فرهنگ‌سازی سازمانی و ایجاد انگیزه و اشتیاق در تیم‌های مدیریتی و کارشناسی هلدینگ با استفاده از ابزارهای آموزشی ابری و در دسترس است. لذا این دوره شامل تعهد به اجرای آموزش بر روی بسترهای آفلاین/لوکال یا تعهد تحویل سامانه، پلتفرم نرم‌افزاری یا پیاده‌سازی عملیاتی نبوده و تصمیم‌گیری در خصوص ابزارهای لوکال صرفاً پس از بلوغ آموزشی تیم در فازهای بعدی مطرح خواهد شد.',
          {
            xRight: CONTENT_X_RIGHT - 8,
            y,
            maxWidth: CONTENT_W - 8,
            size: 10,
            lineHeight: 16.2,
            color: C_SLATE,
          }
        ) - 10;

      page.drawLine({
        start: { x: MARGIN_L, y: y + 6 },
        end: { x: CONTENT_X_RIGHT, y: y + 6 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 12;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        `${CONNECTION_TEST_PROTOCOL.kicker} - ${CONNECTION_TEST_PROTOCOL.headline}:`,
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11,
          color: C_CYAN_DARK,
          badgeColor: C_CYAN_DARK,
        }
      );
      y -= 17;
      y =
        drawWrappedBidiParagraph(
          page,
          fonts.main,
          CONNECTION_TEST_PROTOCOL.subheadline,
          {
            xRight: CONTENT_X_RIGHT - 8,
            y,
            maxWidth: CONTENT_W - 8,
            size: 9.8,
            lineHeight: 15.5,
          }
        ) - 6;

      // 3-step cards
      const cardW = (CONTENT_W - 16) / 3;
      const cardH = 68;
      CONNECTION_TEST_PROTOCOL.steps.forEach((st, idx) => {
        const cx = CONTENT_X_RIGHT - (idx + 1) * cardW - idx * 8;
        page.drawRectangle({
          x: cx,
          y: y - cardH,
          width: cardW,
          height: cardH,
          color: C_LIGHT_BG,
          borderColor: C_BORDER,
          borderWidth: 0.75,
        });
        drawBidiLine(page, fonts.boldTitle, `گام ${st.num}: ${st.title}`, {
          xRight: cx + cardW - 8,
          y: y - 16,
          size: 10,
          color: C_NAVY,
        });
        drawWrappedBidiParagraph(page, fonts.main, st.description, {
          xRight: cx + cardW - 8,
          y: y - 32,
          maxWidth: cardW - 16,
          size: 9,
          lineHeight: 14,
          color: C_SLATE,
        });
      });

      const linkY = y - cardH - 16;
      if (linkY > Y_BOTTOM_LIMIT) {
        drawBidiLine(
          page,
          fonts.main,
          `آدرس تست اتصال: ${CONNECTION_TEST_PROTOCOL.testUrlFull} — ${CONNECTION_TEST_PROTOCOL.footerNote}`,
          {
            xRight: CONTENT_X_RIGHT - 8,
            y: linkY,
            size: 9.2,
            color: C_MUTED,
          }
        );
        addPageLinkAnnotation(
          pdfDoc,
          page,
          [MARGIN_L, linkY - 4, CONTENT_X_RIGHT, linkY + 12],
          CONNECTION_TEST_PROTOCOL.testUrlFull
        );
      }
    }

    // PAGE 19: CHAPTER 5 — 96-HOUR CURRICULUM & CAPSTONE
    {
      const page = createFramedPage(
        '۱۹',
        'فصل پنجم: ساختار و سرفصل‌های بوت‌کمپ جامع ۹۶ ساعته'
      );
      let y = Y_TOP_START;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        `فصل پنجم (${proposal.curriculumTitle} - ${proposal.totalHours})`,
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 13.5,
          badgeColor: C_NAVY,
        }
      );
      y -= 18;
      drawBidiLine(
        page,
        fonts.main,
        `ساختار اجرایی دوره: ${proposal.sessionsFormat}`,
        {
          xRight: CONTENT_X_RIGHT - 12,
          y,
          size: 10,
          color: C_CYAN_DARK,
        }
      );
      y -= 24;

      for (const mod of proposal.modules) {
        const top = y;
        drawBidiLine(
          page,
          fonts.boldTitle,
          `${mod.code} (${mod.hours}):`,
          {
            xRight: CONTENT_X_RIGHT - 10,
            y,
            size: 11,
            color: C_NAVY,
          }
        );
        y -= 17;
        drawBidiLine(page, fonts.boldTitle, mod.title, {
          xRight: CONTENT_X_RIGHT - 16,
          y,
          size: 11.8,
          color: C_INK,
        });
        y -= 17;
        y = drawWrappedBidiParagraph(page, fonts.main, mod.description, {
          xRight: CONTENT_X_RIGHT - 16,
          y,
          maxWidth: CONTENT_W - 20,
          size: 10.2,
          lineHeight: 16.5,
          color: C_SLATE,
        });
        page.drawLine({
          start: { x: CONTENT_X_RIGHT - 2, y: top + 8 },
          end: { x: CONTENT_X_RIGHT - 2, y: y + 8 },
          thickness: 2,
          color: C_NAVY,
        });
        y -= 16;
      }

      page.drawLine({
        start: { x: MARGIN_L, y: y + 8 },
        end: { x: CONTENT_X_RIGHT, y: y + 8 },
        thickness: 0.75,
        color: C_BORDER,
      });
      y -= 12;
      drawAccentHeading(
        page,
        fonts.boldTitle,
        `تمرین کارگاهی و مطالعه موردی پایانی (Educational Case Study):`,
        {
          xRight: CONTENT_X_RIGHT,
          y,
          size: 11.2,
          color: C_CYAN_DARK,
          badgeColor: C_CYAN_DARK,
        }
      );
      y -= 18;
      drawBidiLine(page, fonts.boldTitle, proposal.capstone.title, {
        xRight: CONTENT_X_RIGHT - 10,
        y,
        size: 10.8,
        color: C_INK,
      });
      y -= 18;
      drawWrappedBidiParagraph(page, fonts.main, proposal.capstone.deliverable, {
        xRight: CONTENT_X_RIGHT - 10,
        y,
        maxWidth: CONTENT_W - 10,
        size: 10.2,
        lineHeight: 16.5,
      });
    }
  }

  // ==================== PAGE 20 (OR 4): CLASSROOM PROTOCOL & DAILY SCHEDULE ====================
  onProgress?.('در حال ایجاد پروتکل سالن، جدول زمان‌بندی و پیشنهاد مالی...');
  {
    const pNum = proposal ? '۲۰' : '۴';
    const page = createFramedPage(
      pNum,
      'فصل ششم: پروتکل اجرایی سالن آموزشی و زمان‌بندی روزانه'
    );
    let y = Y_TOP_START;
    drawAccentHeading(
      page,
      fonts.boldTitle,
      'فصل ششم (الزامات اجرایی سالن، تجهیزات و زمان‌بندی بوت‌کمپ)',
      {
        xRight: CONTENT_X_RIGHT,
        y,
        size: 13.5,
        badgeColor: C_NAVY,
      }
    );
    y -= 22;

    for (const clause of PROTOCOL_CLAUSES.slice(0, 6)) {
      y =
        drawBidiBullet(
          page,
          fonts.main,
          '•',
          `بند ${clause.index} - ${clause.title}: ${clause.leadText}`,
          {
            xRight: CONTENT_X_RIGHT - 4,
            y,
            maxWidth: CONTENT_W - 4,
            size: 10,
            lineHeight: 15.8,
            bulletColor: C_CYAN_DARK,
            indent: 14,
          }
        ) - 5;
    }

    y -= 10;
    drawAccentHeading(
      page,
      fonts.boldTitle,
      'برنامه زمان‌بندی استاندارد روزانه کارگاه‌های آموزشی:',
      {
        xRight: CONTENT_X_RIGHT,
        y,
        size: 11.5,
        color: C_NAVY,
        badgeColor: C_NAVY,
      }
    );
    y -= 12;

    y =
      drawVectorTable(
        page,
        y,
        ['ساعت', 'عنوان برنامه', 'شرح اجرایی'],
        DAILY_SCHEDULE.map((s) => [s.timeRange, s.title, s.description]),
        [105, 135, 283.28],
        { fontSize: 9.5, rowPadV: 6 }
      ) - 14;

    page.drawLine({
      start: { x: MARGIN_L, y: y + 6 },
      end: { x: CONTENT_X_RIGHT, y: y + 6 },
      thickness: 0.75,
      color: C_BORDER,
    });
    y -= 10;
    drawWrappedBidiParagraph(
      page,
      fonts.main,
      `• صیانت از حقوق مالکیت معنوی: ${CONFIDENTIALITY_STATEMENT.body} خواهشمند است از هرگونه ضبط صدای مدرسین در طول برگزاری دوره اکیداً خودداری فرمایید.`,
      {
        xRight: CONTENT_X_RIGHT,
        y,
        maxWidth: CONTENT_W,
        size: 9.8,
        lineHeight: 15.8,
      }
    );
  }

  // ==================== PAGE 21 (OR 5): FINANCIAL OFFER & CLOSING WORKSHOP STRIP ====================
  if (proposal) {
    const page = createFramedPage(
      '۲۱',
      'شرایط اجرایی، حق‌الزحمه پیشنهادی و مدارک دوره'
    );
    let y = Y_TOP_START - 12;

    const blocks = [
      {
        title: 'مدت زمان کل دوره:',
        body: proposal.investment.duration,
      },
      {
        title: 'حق‌الزحمه پیشنهادی:',
        body: proposal.investment.totalAmountWords,
      },
      {
        title: 'تعداد نفرات حاضر در دوره:',
        body: proposal.investment.capacity,
      },
      {
        title: 'مدارک شرکت در دوره:',
        body: 'در پایان دوره برای نفرات حاضر در دوره گواهینامه معتبر از طرف شرکت مشاوران مدیریت کسب و کار اوج صادر خواهد گردید.',
      },
    ];

    for (const blk of blocks) {
      drawAccentHeading(page, fonts.boldTitle, blk.title, {
        xRight: CONTENT_X_RIGHT - 14,
        y,
        size: 13,
        color: C_INK,
        badgeColor: C_CYAN_DARK,
      });
      y -= 20;
      y =
        drawWrappedBidiParagraph(page, fonts.main, blk.body, {
          xRight: CONTENT_X_RIGHT - 32,
          y,
          maxWidth: CONTENT_W - 44,
          size: 11.5,
          lineHeight: 19,
        }) - 14;
    }

    const sigY = Math.max(y - 16, 290);
    drawBidiLine(page, fonts.main, 'با تقدیم احترام', {
      centerX: 165,
      y: sigY,
      size: 12,
      align: 'center',
    });
    drawBidiLine(page, fonts.boldTitle, documentMeta.instructorName, {
      centerX: 165,
      y: sigY - 24,
      size: 15,
      align: 'center',
    });
    drawBidiLine(page, fonts.main, documentMeta.instructorRole, {
      centerX: 165,
      y: sigY - 46,
      size: 11.5,
      color: C_SLATE,
      align: 'center',
    });

    drawImageContain(page, closingStripImg, 0, 28, PAGE_W, 195);
  }

  // ==================== FINAL PAGE: FULL BACK COVER MAP ====================
  {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    if (backMapImg) {
      page.drawImage(backMapImg, {
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
      });
      addPageLinkAnnotation(
        pdfDoc,
        page,
        [40, 40, PAGE_W - 40, 220],
        `https://${documentMeta.website}`
      );
    } else {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
        color: C_NAVY,
      });
    }
  }

  onProgress?.('در حال ذخیره‌سازی فایل PDF برداری قابل ویرایش...');
  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  const outFilename =
    filename ||
    (proposal
      ? `OWJ-CPMAI-Proposal-0${proposal.id.replace('khatam-0', '')}-${proposal.repoName}.pdf`
      : 'OWJ-CPMAI-Protocol-Damavand-A4.pdf');

  await saveBinaryFile(
    new Uint8Array(pdfBytes),
    outFilename,
    'application/pdf',
    'PDF Document',
    ['pdf']
  );
}

/** Backwards-compatible fallback wrapper */
export async function exportBrochureToPdf(
  _pageElements: HTMLElement[],
  onProgress?: (msg: string) => void,
  filename?: string
): Promise<void> {
  await exportProposalToVectorPdf(
    null,
    COMPANY_RESUME_DATA,
    DOCUMENT_META,
    `https://${DOCUMENT_META.website}`,
    '',
    onProgress,
    filename
  );
}
