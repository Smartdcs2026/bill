/************************************************************
 * app.js
 * Receipt OCR System Frontend
 ************************************************************/

const API_BASE = 'https://bill.somchaibutphon.workers.dev';

const MAX_IMAGE_WIDTH = 1280;
const JPEG_QUALITY = 0.82;

let appState = {
  brands: [],
  templates: [],
  selectedFile: null,
  imageBase64: '',
  imageMimeType: 'image/jpeg',
  rawText: '',
  parsed: {}
};

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  bindEvents();
  await loadOptions();
}

function bindEvents() {
  document.getElementById('chooseImageBtn').addEventListener('click', () => {
    document.getElementById('imageInput').click();
  });

  document.getElementById('imageInput').addEventListener('change', handleImageChange);
  document.getElementById('ocrBtn').addEventListener('click', runOCR);
  document.getElementById('clearBtn').addEventListener('click', clearForm);
  document.getElementById('saveBtn').addEventListener('click', saveRecord);
}

async function loadOptions() {
  try {
    const res = await fetch(`${API_BASE}/api/options`);
    const data = await res.json();

    if (!data.ok) throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ');

    appState.brands = data.brands || [];
    appState.templates = data.templates || [];

    renderBrandOptions();

  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'โหลดแบรนด์ไม่ได้',
      text: err.message
    });

    renderFallbackBrands();
  }
}

function renderBrandOptions() {
  const select = document.getElementById('brandSelect');

  select.innerHTML = '<option value="">เลือกแบรนด์</option>';

  appState.brands.forEach(brand => {
    const opt = document.createElement('option');
    opt.value = brand.brandCode;
    opt.textContent = `${brand.brandCode} - ${brand.brandName}`;
    select.appendChild(opt);
  });
}

function renderFallbackBrands() {
  const fallback = ['CJ', 'MB', 'JF', 'TD', 'LE'];
  const select = document.getElementById('brandSelect');

  select.innerHTML = '<option value="">เลือกแบรนด์</option>';

  fallback.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    select.appendChild(opt);
  });
}

async function handleImageChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  appState.selectedFile = file;

  try {
    const resizedBase64 = await resizeImageToBase64(file);

    appState.imageBase64 = resizedBase64;
    appState.imageMimeType = 'image/jpeg';

    const img = document.getElementById('previewImage');
    img.src = resizedBase64;

    document.getElementById('previewWrap').classList.remove('hidden');

  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'อ่านรูปไม่ได้',
      text: err.message
    });
  }
}

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');

        let width = img.width;
        let height = img.height;

        if (width > MAX_IMAGE_WIDTH) {
          height = Math.round(height * (MAX_IMAGE_WIDTH / width));
          width = MAX_IMAGE_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const base64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve(base64);
      };

      img.onerror = () => reject(new Error('ไฟล์รูปไม่ถูกต้อง'));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
    reader.readAsDataURL(file);
  });
}

async function runOCR() {
  const recorderName = document.getElementById('recorderName').value.trim();
  const brandCode = document.getElementById('brandSelect').value;

  if (!recorderName) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกชื่อผู้บันทึก'
    });
  }

  if (!brandCode) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกแบรนด์'
    });
  }

  if (!appState.imageBase64) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรุณาถ่ายภาพหรือเลือกรูปใบเสร็จ'
    });
  }

  Swal.fire({
    title: 'กำลังอ่าน OCR',
    html: 'ระบบกำลังอ่านข้อความจากใบเสร็จ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const result = await Tesseract.recognize(
      appState.imageBase64,
      'eng',
      {
        logger: m => {
          if (m.status === 'recognizing text') {
            const percent = Math.round((m.progress || 0) * 100);
            Swal.update({
              html: `กำลังอ่านข้อความ ${percent}%`
            });
          }
        }
      }
    );

    const rawText = normalizeOCRText(result.data.text || '');
    appState.rawText = rawText;

    const parsed = parseReceiptByBrand(rawText, brandCode);
    appState.parsed = parsed;

    fillResultFields(parsed, rawText);

    document.getElementById('resultSection').classList.remove('hidden');

    Swal.fire({
      icon: 'success',
      title: 'อ่านข้อมูลเสร็จแล้ว',
      text: 'กรุณาตรวจสอบข้อมูลก่อนบันทึก'
    });

  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'OCR ไม่สำเร็จ',
      text: err.message
    });
  }
}

function normalizeOCRText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[|]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseReceiptByBrand(rawText, brandCode) {
  const brandTemplates = appState.templates
    .filter(t => String(t.brandCode).toUpperCase() === String(brandCode).toUpperCase())
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));

  if (!brandTemplates.length) {
    return parseWithBasicRules(rawText);
  }

  let bestResult = {};
  let bestScore = -1;

  brandTemplates.forEach(template => {
    const parsed = parseWithRules(rawText, template.rules || {});
    const score = scoreParsedResult(parsed);

    if (score > bestScore) {
      bestScore = score;
      bestResult = parsed;
    }
  });

  return bestResult;
}

function parseWithBasicRules(rawText) {
  return {
    receiptNo: firstRegex(rawText, /(BNO|NO|Receipt|Ref|Bill|Doc)[\s:#-]*([A-Z0-9\-\/]+)/i, 2),
    receiptDate: firstRegex(rawText, /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/, 1),
    receiptTime: firstRegex(rawText, /(\d{2}[:.]\d{2}(?::\d{2})?)/, 1),
    posNo: firstRegex(rawText, /(POS|Terminal|Till)[\s:#-]*([A-Z0-9\-\/]+)/i, 2),
    cashier: firstRegex(rawText, /(Cashier|Staff|Emp)[\s:#-]*([A-Z0-9\-\/]+)/i, 2),
    subtotal: findNumberNearKeyword(rawText, ['SUBTOTAL', 'SUB TOTAL']),
    vat: findNumberNearKeyword(rawText, ['VAT', 'TAX']),
    total: findNumberNearKeyword(rawText, ['TOTAL', 'NET', 'AMOUNT', 'BALANCE']),
    paymentType: findLineByKeyword(rawText, ['CASH', 'CARD', 'PROMPTPAY', 'QR'])
  };
}

function parseWithRules(rawText, rules) {
  const output = {};

  Object.keys(rules).forEach(fieldName => {
    const ruleList = Array.isArray(rules[fieldName])
      ? rules[fieldName]
      : [rules[fieldName]];

    for (const rule of ruleList) {
      const value = applyRule(rawText, rule);

      if (value !== '') {
        output[fieldName] = value;
        break;
      }
    }

    if (!output[fieldName]) output[fieldName] = '';
  });

  return output;
}

function applyRule(rawText, rule) {
  if (!rule || !rule.type) return '';

  if (rule.type === 'regex') {
    return firstRegex(rawText, new RegExp(rule.pattern, 'i'), Number(rule.group || 1));
  }

  if (rule.type === 'keywordNumber') {
    return findNumberNearKeyword(rawText, rule.keywords || []);
  }

  if (rule.type === 'keywordLine') {
    return findLineByKeyword(rawText, rule.keywords || []);
  }

  if (rule.type === 'lineNumber') {
    return getLineValue(rawText, Number(rule.lineIndex || 0));
  }

  if (rule.type === 'afterKeywordLine') {
    return getLineAfterKeyword(rawText, rule.keywords || [], Number(rule.offset || 1));
  }

  return '';
}

function firstRegex(text, regex, groupIndex) {
  const match = String(text || '').match(regex);
  return match && match[groupIndex] ? cleanValue(match[groupIndex]) : '';
}

function findNumberNearKeyword(text, keywords) {
  const lines = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);

  for (const keyword of keywords) {
    const upperKeyword = String(keyword).toUpperCase();

    for (const line of lines) {
      const upperLine = line.toUpperCase();

      if (upperLine.includes(upperKeyword)) {
        const numbers = line.match(/\d+(?:[,.]\d{2})?/g);

        if (numbers && numbers.length) {
          return cleanMoney(numbers[numbers.length - 1]);
        }
      }
    }
  }

  return '';
}

function findLineByKeyword(text, keywords) {
  const lines = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);

  for (const keyword of keywords) {
    const upperKeyword = String(keyword).toUpperCase();

    for (const line of lines) {
      if (line.toUpperCase().includes(upperKeyword)) {
        return cleanValue(line);
      }
    }
  }

  return '';
}

function getLineValue(text, lineIndex) {
  const lines = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);
  return lines[lineIndex] ? cleanValue(lines[lineIndex]) : '';
}

function getLineAfterKeyword(text, keywords, offset) {
  const lines = String(text || '').split('\n').map(x => x.trim()).filter(Boolean);

  for (const keyword of keywords) {
    const upperKeyword = String(keyword).toUpperCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toUpperCase().includes(upperKeyword)) {
        const targetIndex = i + offset;
        return lines[targetIndex] ? cleanValue(lines[targetIndex]) : '';
      }
    }
  }

  return '';
}

function scoreParsedResult(parsed) {
  let score = 0;

  Object.keys(parsed || {}).forEach(key => {
    if (parsed[key]) score += 1;
  });

  if (parsed.total) score += 2;
  if (parsed.receiptNo) score += 2;
  if (parsed.receiptDate) score += 2;

  return score;
}

function fillResultFields(parsed, rawText) {
  setValue('receiptNo', parsed.receiptNo);
  setValue('receiptDate', parsed.receiptDate);
  setValue('receiptTime', normalizeTime(parsed.receiptTime));
  setValue('posNo', parsed.posNo);
  setValue('cashier', parsed.cashier);
  setValue('subtotal', parsed.subtotal);
  setValue('vat', parsed.vat);
  setValue('total', parsed.total);
  setValue('paymentType', parsed.paymentType);
  setValue('rawText', rawText);
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function normalizeTime(value) {
  if (!value) return '';
  return String(value).replace('.', ':');
}

function cleanValue(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMoney(value) {
  return String(value || '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '')
    .trim();
}

async function saveRecord() {
  const recorderName = getValue('recorderName');
  const brandCode = getValue('brandSelect');

  if (!recorderName) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกชื่อผู้บันทึก'
    });
  }

  if (!brandCode) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรุณาเลือกแบรนด์'
    });
  }

  if (!appState.imageBase64) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรุณาแนบภาพใบเสร็จ'
    });
  }

  const brand = appState.brands.find(b => b.brandCode === brandCode);

  const payload = {
    data: {
      recorderName,
      brandCode,
      brandName: brand?.brandName || brandCode,
      receiptNo: getValue('receiptNo'),
      receiptDate: getValue('receiptDate'),
      receiptTime: getValue('receiptTime'),
      posNo: getValue('posNo'),
      cashier: getValue('cashier'),
      subtotal: getValue('subtotal'),
      vat: getValue('vat'),
      total: getValue('total'),
      paymentType: getValue('paymentType'),
      rawText: getValue('rawText'),
      parsed: appState.parsed || {},
      userNote: getValue('userNote'),
      image: {
        base64: appState.imageBase64,
        mimeType: appState.imageMimeType,
        fileName: appState.selectedFile?.name || 'receipt.jpg'
      }
    }
  };

  Swal.fire({
    title: 'กำลังบันทึก',
    html: 'กำลังส่งข้อมูลและบันทึกรูปภาพ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const res = await fetch(`${API_BASE}/api/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!data.ok) {
      throw new Error(data.message || 'บันทึกไม่สำเร็จ');
    }

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ',
      html: `
        <div style="text-align:left;font-size:14px">
          <div><b>เวลา:</b> ${data.timestamp || '-'}</div>
          <div><b>Image ID:</b> ${data.imageFileId || '-'}</div>
        </div>
      `
    });

    clearForm();

  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'บันทึกไม่สำเร็จ',
      text: err.message
    });
  }
}

function clearForm() {
  appState.selectedFile = null;
  appState.imageBase64 = '';
  appState.rawText = '';
  appState.parsed = {};

  document.getElementById('imageInput').value = '';
  document.getElementById('previewImage').src = '';
  document.getElementById('previewWrap').classList.add('hidden');
  document.getElementById('resultSection').classList.add('hidden');

  [
    'receiptNo',
    'receiptDate',
    'receiptTime',
    'posNo',
    'cashier',
    'subtotal',
    'vat',
    'total',
    'paymentType',
    'userNote',
    'rawText'
  ].forEach(id => setValue(id, ''));
}
