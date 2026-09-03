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

## 雲端方案

私人新版網站提供「儲存方案」功能。老師登入後可以命名、儲存、載入、更新及刪除自己的座位表方案；方案會綁定登入帳戶，其他帳戶不能讀取。GitHub 公開版沒有這個雲端資料庫服務，仍可使用本機儲存。

## 私隱

學生名單在瀏覽器內處理；使用者儲存雲端方案後，方案內的學生資料會存放在私人新版網站的雲端資料庫，並按登入帳戶隔離。學生名單不會預設任何 Google Drive 連結，使用者可在匯入視窗貼上自己的 Google Sheets / Drive 連結，或上載 Excel、CSV、文字檔及 Word 名單；班主任資料則會由已設定的 Google Sheets 共用連結自動讀取。
