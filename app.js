/************************************************************
 * app.js
 * Receipt OCR System Frontend - CJ Round 5
 * รองรับ config.js + PWA
 ************************************************************/

const CONFIG = window.RECEIPT_OCR_CONFIG || {};
const API_BASE = CONFIG.API_BASE || 'https://bill.somchaibutphon.workers.dev';
const MAX_IMAGE_WIDTH = CONFIG.OCR?.MAX_IMAGE_WIDTH || 1400;
const JPEG_QUALITY = CONFIG.OCR?.JPEG_QUALITY || 0.86;
const OCR_LANG = CONFIG.OCR?.LANG || 'eng';

let currentUser = null;
let imageItems = [];
let lastValidation = null;

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  setDefaultMonth();
  renderImageList();
  setInterval(updateClientTime, 1000);
  updateClientTime();
});

function bindEvents() {
  byId('loginBtn').addEventListener('click', login);
  byId('loginPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });

  byId('logoutBtn').addEventListener('click', logout);
  byId('adminLogoutBtn').addEventListener('click', logout);
  byId('goUserPageBtn').addEventListener('click', () => showPage('appPage'));

  byId('addImageBtn').addEventListener('click', () => byId('imageInput').click());
  byId('imageInput').addEventListener('change', addImage);
  byId('ocrBtn').addEventListener('click', runOCRAndValidate);
  byId('clearBtn').addEventListener('click', clearBatch);
  byId('saveBtn').addEventListener('click', confirmAndSave);
  byId('loadHistoryBtn').addEventListener('click', loadHistory);
  byId('saveRuleBtn').addEventListener('click', saveCJRule);
}

async function login() {
  const pass = byId('loginPass').value.trim();

  if (!pass) {
    return Swal.fire({ icon: 'warning', title: 'กรุณากรอกรหัสผ่าน' });
  }

  Swal.fire({
    title: 'กำลังเข้าสู่ระบบ',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const data = await postJson('/api/login', { pass });

    if (!data.ok) throw new Error(data.message || 'เข้าสู่ระบบไม่สำเร็จ');

    currentUser = {
      name: data.name,
      role: data.role,
      isAdmin: data.isAdmin,
      pass: data.pass
    };

    Swal.close();

    if (currentUser.isAdmin) {
      byId('adminBadge').textContent = `ผู้ดูแลระบบ: ${currentUser.name}`;
      showPage('adminPage');
    } else {
      byId('userBadge').textContent = `ผู้ใช้งาน: ${currentUser.name}`;
      showPage('appPage');
    }

  } catch (err) {
    Swal.fire({ icon: 'error', title: 'เข้าสู่ระบบไม่สำเร็จ', text: err.message });
  }
}

function logout() {
  currentUser = null;
  clearBatch();
  byId('loginPass').value = '';
  showPage('loginPage');
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  byId(id).classList.add('active');

  if (id === 'appPage' && currentUser) {
    byId('userBadge').textContent = `ผู้ใช้งาน: ${currentUser.name}`;
  }
}

async function addImage(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    Swal.fire({
      title: 'กำลังเตรียมภาพ',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const base64 = await preprocessImage(file);
    const item = {
      index: imageItems.length + 1,
      sourceImageIndex: imageItems.length + 1,
      imageTempId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      imageName: file.name || `receipt_${imageItems.length + 1}.jpg`,
      mimeType: 'image/jpeg',
      base64,
      rawText: ''
    };

    imageItems.push(item);
    renderImageList();
    byId('imageInput').value = '';

    Swal.close();

  } catch (err) {
    Swal.fire({ icon: 'error', title: 'เพิ่มภาพไม่สำเร็จ', text: err.message });
  }
}

function renderImageList() {
  const box = byId('imageList');

  if (!imageItems.length) {
    box.innerHTML = `<div class="data-row">ยังไม่มีภาพในรอบนี้</div>`;
    return;
  }

  box.innerHTML = imageItems.map((img, i) => `
    <div class="image-card">
      <img src="${img.base64}" alt="receipt">
      <div class="image-meta">
        <b>ภาพที่ ${i + 1}</b>
        <span>${escapeHtml(img.imageName)}</span>
        <span>${img.rawText ? 'อ่าน OCR แล้ว' : 'ยังไม่ได้อ่าน OCR'}</span>
      </div>
      <button class="remove-img" type="button" onclick="removeImage(${i})">ลบ</button>
    </div>
  `).join('');
}

function removeImage(index) {
  imageItems.splice(index, 1);
  imageItems = imageItems.map((img, i) => ({
    ...img,
    index: i + 1,
    sourceImageIndex: i + 1
  }));
  renderImageList();
}

async function runOCRAndValidate() {
  if (!currentUser) return Swal.fire({ icon: 'warning', title: 'กรุณาเข้าสู่ระบบ' });

  const targetMonth = byId('targetMonth').value;
  const collectionRound = byId('collectionRound').value;

  if (!targetMonth) return Swal.fire({ icon: 'warning', title: 'กรุณาเลือกเดือนข้อมูล' });
  if (!imageItems.length) return Swal.fire({ icon: 'warning', title: 'กรุณาเพิ่มภาพบิล' });

  Swal.fire({
    title: 'กำลังอ่าน OCR',
    html: 'เตรียมอ่านภาพ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    for (let i = 0; i < imageItems.length; i++) {
      Swal.update({ html: `กำลังอ่านข้อความภาพที่ ${i + 1} / ${imageItems.length}` });

      if (!imageItems[i].rawText) {
        const result = await Tesseract.recognize(imageItems[i].base64, OCR_LANG, {
          logger: m => {
            if (m.status === 'recognizing text') {
              const percent = Math.round((m.progress || 0) * 100);
              Swal.update({ html: `ภาพที่ ${i + 1}: OCR ${percent}%` });
            }
          }
        });

        imageItems[i].rawText = normalizeText(result.data.text || '');
      }
    }

    Swal.update({ html: 'กำลังตรวจเงื่อนไข CJ...' });

    const validation = await postJson('/api/cj/validate', {
      actor: currentUser,
      targetMonth,
      collectionRound,
      images: imageItems
    });

    if (!validation.ok) throw new Error(validation.message || 'ตรวจสอบไม่สำเร็จ');

    lastValidation = validation;

    renderValidation(validation);
    await showValidationSwal(validation);

  } catch (err) {
    Swal.fire({ icon: 'error', title: 'OCR / ตรวจสอบไม่สำเร็จ', text: err.message });
  }
}

function renderValidation(data) {
  byId('resultPanel').classList.remove('hidden');

  const s = data.summary || {};

  byId('summaryCards').innerHTML = `
    <div class="summary-card"><b>${s.totalRows || 0}</b><span>พบทั้งหมด</span></div>
    <div class="summary-card"><b>${s.validCount || 0}</b><span>ผ่าน</span></div>
    <div class="summary-card"><b>${s.invalidCount || 0}</b><span>ไม่ผ่าน</span></div>
    <div class="summary-card"><b>${s.posCount || 0}</b><span>POS ผ่าน</span></div>
  `;

  byId('resultRows').innerHTML = (data.rows || []).map(row => renderDataRow(row)).join('');
}

function renderDataRow(row) {
  const pass = row.status === 'PASS';

  return `
    <div class="data-row ${pass ? 'pass' : 'fail'}">
      <div class="row-main">
        <div><b>วันที่:</b> ${escapeHtml(row.receiptDate || '-')} ${escapeHtml(row.receiptTime || '')}</div>
        <div><b>ร้าน:</b> ${escapeHtml(row.storeCode || '-')}</div>
        <div><b>POS:</b> ${escapeHtml(row.posNo || '-')}</div>
        <div><b>ลูกค้า:</b> ${escapeHtml(row.customerNo || '-')}</div>
        <div><b>BNO:</b> ${escapeHtml(row.bno || '-')}</div>
        <div class="${pass ? 'status-pass' : 'status-fail'}">${pass ? 'ผ่าน' : 'ไม่ผ่าน'}</div>
      </div>
      ${row.rejectReason ? `<div class="reason">${escapeHtml(row.rejectReason)}</div>` : ''}
    </div>
  `;
}

async function showValidationSwal(data) {
  const valid = data.validRows || [];
  const invalid = data.invalidRows || [];

  const tableRows = (data.rows || []).map(row => `
    <tr>
      <td>${escapeHtml(row.storeCode || '-')}</td>
      <td>${escapeHtml(row.posNo || '-')}</td>
      <td>${escapeHtml(row.customerNo || '-')}</td>
      <td class="${row.status === 'PASS' ? 'ok' : 'bad'}">${row.status === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน'}</td>
    </tr>
  `).join('');

  return Swal.fire({
    title: 'ตรวจสอบก่อนบันทึก',
    html: `
      <div style="text-align:left">
        <div><b>เดือน:</b> ${escapeHtml(data.targetMonth || '-')}</div>
        <div><b>ครั้งที่:</b> ${escapeHtml(String(data.collectionRound || '-'))}</div>
        <div><b>ผู้บันทึก:</b> ${escapeHtml(currentUser.name)}</div>
        <div style="margin:8px 0"><b>ผ่าน:</b> ${valid.length} รายการ | <b>ไม่ผ่าน:</b> ${invalid.length} รายการ</div>
        <table class="swal-table">
          <thead><tr><th>ร้าน</th><th>POS</th><th>ลูกค้า</th><th>สถานะ</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `,
    width: 720,
    showCancelButton: true,
    confirmButtonText: valid.length ? 'บันทึกรายการที่ผ่าน' : 'ปิด',
    cancelButtonText: 'ตรวจดูอีกครั้ง'
  }).then(res => {
    if (res.isConfirmed && valid.length) confirmAndSave();
  });
}

async function confirmAndSave() {
  if (!lastValidation || !(lastValidation.validRows || []).length) {
    return Swal.fire({ icon: 'warning', title: 'ไม่มีรายการที่ผ่านเงื่อนไข' });
  }

  const ask = await Swal.fire({
    icon: 'question',
    title: 'ยืนยันบันทึก?',
    text: `จะบันทึก ${lastValidation.validRows.length} รายการที่ผ่านเงื่อนไข`,
    showCancelButton: true,
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก'
  });

  if (!ask.isConfirmed) return;

  Swal.fire({
    title: 'กำลังบันทึก',
    html: 'กำลังบันทึกข้อมูลและรูปภาพ...',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const data = await postJson('/api/cj/save', {
      actor: currentUser,
      targetMonth: byId('targetMonth').value,
      collectionRound: byId('collectionRound').value,
      images: imageItems,
      validationData: lastValidation
    });

    if (!data.ok) throw new Error(data.message || 'บันทึกไม่สำเร็จ');

    Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ',
      html: `<div style="text-align:left">
        <div><b>จำนวน:</b> ${data.savedCount || 0} รายการ</div>
        <div><b>Image Group:</b> ${escapeHtml(data.imageGroupId || '-')}</div>
      </div>`
    });

    clearBatch();
    loadHistory();

  } catch (err) {
    Swal.fire({ icon: 'error', title: 'บันทึกไม่สำเร็จ', text: err.message });
  }
}

async function loadHistory() {
  const targetMonth = byId('targetMonth').value;

  Swal.fire({
    title: 'กำลังโหลดข้อมูล',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const data = await postJson('/api/history', {
      brandCode: 'CJ',
      targetMonth
    });

    if (!data.ok) throw new Error(data.message || 'โหลดข้อมูลไม่สำเร็จ');

    Swal.close();

    byId('historyList').innerHTML = data.rows.length
      ? data.rows.map(renderHistoryRow).join('')
      : '<div class="data-row">ยังไม่มีข้อมูล</div>';

  } catch (err) {
    Swal.fire({ icon: 'error', title: 'โหลดข้อมูลไม่สำเร็จ', text: err.message });
  }
}

function renderHistoryRow(row) {
  return `
    <div class="data-row pass">
      <div class="row-main">
        <div><b>เวลา:</b> ${escapeHtml(row.timestamp || '-')}</div>
        <div><b>ผู้บันทึก:</b> ${escapeHtml(row.recorderName || '-')}</div>
        <div><b>ร้าน:</b> ${escapeHtml(row.storeCode || '-')}</div>
        <div><b>POS:</b> ${escapeHtml(row.posNo || '-')}</div>
        <div><b>ลูกค้า:</b> ${escapeHtml(row.customerNo || '-')}</div>
        <div><b>ครั้งที่:</b> ${escapeHtml(row.collectionRound || '-')}</div>
      </div>
      ${row.imageUrl ? `<div style="margin-top:10px"><a class="small-btn primary" href="${row.imageUrl}" target="_blank" rel="noopener">ดูภาพบิล</a></div>` : ''}
    </div>
  `;
}

async function saveCJRule() {
  if (!currentUser || !currentUser.isAdmin) {
    return Swal.fire({ icon: 'error', title: 'ต้องเป็น Admin เท่านั้น' });
  }

  const rule = {
    brandCode: 'CJ',
    ruleName: byId('ruleName').value.trim() || 'CJ_DEFAULT_RULE',
    enabled: true,
    monthlyCollectionCount: Number(byId('ruleMonthlyCount').value || 4),
    requireMonthMatch: byId('ruleRequireMonth').checked,
    requireSingleStorePerBatch: byId('ruleSingleStore').checked,
    rejectDuplicatePosInBatch: byId('ruleDuplicatePos').checked,
    rejectCustomerLessThanPrevious: byId('ruleCustomerLess').checked,
    dateLinePattern: byId('dateLinePattern').value.trim(),
    bnoPattern: byId('bnoPattern').value.trim()
  };

  try {
    const data = await postJson('/api/admin/rule/save', {
      actor: currentUser,
      rule
    });

    if (!data.ok) throw new Error(data.message || 'บันทึก Rule ไม่สำเร็จ');

    Swal.fire({ icon: 'success', title: 'บันทึก Rule สำเร็จ' });

  } catch (err) {
    Swal.fire({ icon: 'error', title: 'บันทึก Rule ไม่สำเร็จ', text: err.message });
  }
}

function clearBatch() {
  imageItems = [];
  lastValidation = null;
  byId('resultPanel').classList.add('hidden');
  renderImageList();
}

function setDefaultMonth() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  byId('targetMonth').value = `${yyyy}-${mm}`;
}

function updateClientTime() {
  const el = byId('clientTimeText');
  if (el) el.value = formatDateTimeTH(new Date());
}

function formatDateTimeTH(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > MAX_IMAGE_WIDTH) {
          height = Math.round(height * (MAX_IMAGE_WIDTH / width));
          width = MAX_IMAGE_WIDTH;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const contrast = Math.min(255, Math.max(0, (gray - 128) * 1.18 + 128));
          data[i] = contrast;
          data[i + 1] = contrast;
          data[i + 2] = contrast;
        }

        ctx.putImageData(imageData, 0, 0);

        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };

      img.onerror = () => reject(new Error('ไฟล์ภาพไม่ถูกต้อง'));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error('อ่านไฟล์ภาพไม่ได้'));
    reader.readAsDataURL(file);
  });
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[|]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function postJson(path, payload) {
  const isGet = path === '/api/options';

  const res = await fetch(API_BASE + path, {
    method: isGet ? 'GET' : 'POST',
    headers: isGet ? undefined : { 'Content-Type': 'application/json' },
    body: isGet ? undefined : JSON.stringify(payload || {})
  });

  return await res.json();
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
