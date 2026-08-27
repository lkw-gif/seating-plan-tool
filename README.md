# 同學各位找個位

給中學老師使用的座位表編排工具。支援 Excel、Word、貼上名單及 Google Drive / Google Sheets 連結匯入，並可匯出 PDF 和橫向 DOCX。

## 本機開發

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```

網站會輸出到 `dist/client`。推送到 `main` 後，GitHub Actions 會自動部署 GitHub Pages。

## 私隱

學生名單只在使用者的瀏覽器內處理及儲存。原始碼不包含學校 Google Drive 連結；使用者需要在工具內自行貼上有權限存取的連結。
