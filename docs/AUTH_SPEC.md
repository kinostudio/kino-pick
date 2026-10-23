# KINO Pic 身分與登入綁定（2026-10-23）

使用者明確決定：一個平台帳號可只綁 Google、只綁 GitHub，或綁定兩者作同一身分。固定內部 identity 是 Supabase user.id；workspace/member/profile 只參照這個 ID。不同來源的 email、名稱或 profile 圖片不能作應用的 identity merge 依據。

目前沿用 Next.js/Supabase，已實作 SDK PKCE 登入及主動綁定、server getUser、私有短效 hashed intent、前後 actor 相等驗證、completion audit 與來源 allowlist。綁定另一來源前需已有經 Auth server 驗證的 session，再向另一 provider 授權。這不等同每次都強制重新輸入原 provider 密碼；fresh reauthentication 另列安全強化。

設定、外部必要開關、automatic linking 邊界及操作步驟見 LOCAL_AUTH.md。無解除綁定或合併兩個既有平台帳號的入口；不展示無實作控制。尚未配置真實 provider keys，所有瀏覽器 OAuth 測試是獨立 fixture。

新出現的 docsCODEX_ARCHITECTURE_ADDENDUM.md 為新增參考文件，包含 Workers/D1、closed registration、人工 Owner bootstrap、禁止 Email 自動 linking 等與現況不同的要求。此回合確認的是 OAuth 來源/同身分模型；沒有把文件內部署切換指令自動當成使用者要求並覆蓋既有 stack，也沒有宣稱已符合其全部要求。下一個獨立相容性評估須處理：Supabase automatic email linking、closed/Owner 授權、fresh reauthentication/安全 unlink、D1 與既有 PostgreSQL RLS/鎖/RPC 的差異及資料遷移。原始功能規格繼續保留。

第一階段相容性盤點與隔離 SQLite 交易實驗已完成，結果見 ADR-Cloudflare-Free-First.md；Auth 實作替換、Owner/closed/fresh reauth 等仍待各自的實作與驗證。
