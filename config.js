/************************************************************
 * config.js
 * Receipt OCR CJ - Frontend Config
 *
 * แก้ API_BASE ที่ไฟล์นี้ไฟล์เดียว
 ************************************************************/

window.RECEIPT_OCR_CONFIG = {
  API_BASE: 'https://bill.somchaibutphon.workers.dev',
  APP_NAME: 'Receipt OCR CJ',
  APP_VERSION: 'CJ_RULE_ENGINE_V1',
  TIME_FORMAT: 'dd/MM/yyyy HH:mm:ss',
  TIMEZONE: 'Asia/Bangkok',

  OCR: {
    LANG: 'eng',
    MAX_IMAGE_WIDTH: 1400,
    JPEG_QUALITY: 0.86
  }
};
