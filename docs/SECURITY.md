# Security / Privacy / Abuse Prevention

## 不可退讓政策

1. **R2 私有**：原始照片/版本/成品一律 private buckets，最小權限 R2 S3 creds。圖片透過受權驗證的 gateway 或短期權限憑證讀取；撤銷後應停止產生新 grant，對已發出的 grant 必須短 TTL 並註明最大撤銷延遲。
2. **租戶隔離**：workspace_id 是所有業務查詢必要條件，RLS + server permission service；Cross-tenant IDOR 做負面測試。
3. **Google / GitHub OAuth**：用 provider subject / Supabase user ID 做穩定身份綁定，非只比對顯示 email；redirect URI 白名單；server session secure。
4. **分享連結**：token 至少 256-bit 隨機，DB SHA256 hash；password 使用穩健 KDF+salt；節流和短期 session。不要在 log/referrer/analytics 內記 raw invite URL；防爬蟲、索引關閉。
5. **Guest Cookie**：HttpOnly + Secure + SameSite，server/session-expiration/revocation，CSRF 防護；擁有單相簿 token 不取得其他相簿存取能力。
6. **上傳**：大小、MIME+magic bytes、簽署資料匹配、圖片解析器限制、EXIF GPS 移除策略、病毒/惡意檔掃描或 sandbox、安全 SVG 禁用。避免 decompression bombs；S3 multipart 尚未完成禁止分配為 ready。
7. **下載**：resolution/version 檢查；只允許 project scope 且有下載 permission；存取 log；下載 grant TTL 小於 5 分鐘（或有等效合理值），原圖不可長期公開。
8. **Web 安全**：Zod input validation; escaping comment content; CSP; XSS prevention; SSRF 防護（尤其後端不接受任意 URL 下載影像）；rate limit、content-type 和 MIME sniffing defense。
9. **資料刪除**：policy opt-in + dry-run，禁止自動清理 legal hold / pinned / active；刪除 job 不應被一般 guest 呼叫；key 已刪仍保留最低限度審計 tombstone（受保留期限與資料刪除權要求）。
10. **Secrets**：`.env.example` 沒有真秘密；production 使用 secret manager/Cloudflare secrets/Vercel env；不要上傳客戶真照到公共 CI logs；採 staging synthetic photos。

## Threat model

| 威脅                         | 防禦                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| 猜 photo UUID / workspace ID | DB RLS + tenant-scoped API + image gateway checks                   |
| 公開分享連結轉傳             | 明確提示 bearer link 風險、可選密碼/OTP、期限、撤銷、作用域         |
| 用戶重放選取 API 超額        | DB row lock、request idempotency、server limit check                |
| 兩個 cron 同時刪除           | job lease、Postgres row lock、重入設計、idempotent R2 operations    |
| bot 反覆瀏覽延後清理         | valid human session、thumbnail 不算、去重/節流                      |
| 同名跨專案誤覆寫             | workspace/project/album scope & immutable assets & ambiguous review |
| 熱區圖洩漏無權限版本         | diff asset 授權依原 photo + 兩版本的權限                            |
| client activity 被更新覆寫   | append-only event + DB permission + atomic mutation                 |
| 測試時意外清真資料           | production env guard + dry-run default + synthetic staging          |

## 隱私／資料保留

定義 owner、guest 的資料保留與可清除政策、帳號及專案匯出。活動歷程有身份識別可能性，採最小資料、可配置保留期、清理/匿名化後 audit 最小證據。設計應支援依法處理當事人資料請求，法規遵循需按實際營運地再審核。

## Release gate

通過 auth/guest/tenant security tests、基本依賴漏洞掃描、R2 bucket permissions review、變更前 storage dry-run review、沒有任何 `NEXT_PUBLIC_*` secret 或私有 access key 進 bundle。
