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

雲端網站提供「使用 Google 登入」及「儲存方案」功能。老師登入自己的 Google 帳戶後，可以命名、儲存、載入、更新及刪除自己的座位表方案；方案以 Google 帳戶的固定識別碼分隔，其他帳戶不能讀取。GitHub Pages 版本沒有雲端資料庫服務，仍可使用本機儲存。

正式環境需要設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REDIRECT_URI` 及至少 32 字元的 `SESSION_SECRET`。Google OAuth 的已授權重新導向 URI 必須完全相符：

```text
https://classroom-seating-plan-hk.davidlui.chatgpt.site/api/auth/google/callback
```

如只准學校帳戶登入，可把學校網域填入 `GOOGLE_ALLOWED_DOMAIN`；留空則容許所有已驗證的 Google 帳戶。

## 私隱

學生名單在瀏覽器內處理；使用者儲存雲端方案後，方案內的學生資料會存放在網站的雲端資料庫，並按 Google 帳戶隔離。網站只要求基本身份資料，不會取得 Gmail 郵件或 Google Drive 內容。學生名單不會預設任何 Google Drive 連結，使用者可在匯入視窗貼上自己的 Google Sheets / Drive 連結，或上載 Excel、CSV、文字檔及 Word 名單；班主任資料則會由已設定的 Google Sheets 共用連結自動讀取。
