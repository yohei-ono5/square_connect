# Googleログイン・権限設定ガイド

Square Connectのログイン方法、初回導入、本番切り替え、日常運用をまとめる。
Google Cloud、Supabase、Cloudflareを含むシステム設定はシステム運用者が管理し、
店舗のスタッフに設定作業は依頼しない。

## 認証構成

- Google OAuth：Googleアカウントの本人確認、パスワード、2段階認証、アカウント復旧
- Supabase Auth：Google認証の受け口、ユーザーID、アプリのセッションとアクセストークン
- Square Connect：店舗への利用申請、承認状態、`admin`／`staff`権限、利用停止

Supabase AuthはGoogleログインへ変更した後も必要である。メール・パスワード認証、
招待メール、パスワード再設定メールは使用しない。

## 権限

| 権限 | できること | 付与方法 |
|---|---|---|
| `staff` | 商品の登録・編集・Square連携 | 店舗管理者が利用申請を承認 |
| `admin` | `staff`の操作＋申請の承認・却下、スタッフの利用停止 | システム運用者がSQLで付与 |
| システム管理者 | システム全体の運用。店舗管理者からは付与不可 | システム運用者が`system_admins`へ登録 |

システム管理者も操作対象店舗を決めるため、対象店舗の`store_memberships`が必要である。
店舗管理者が承認できるのは`staff`だけとし、誤操作による管理者の増加を防ぐ。

## Google Cloudの設定

システム運用者が所有するGoogle Cloudプロジェクトで、Webアプリケーション用の
OAuth Clientを1つ作成する。店舗ごと、スタッフごとのGoogle Cloud設定は不要である。

1. Google Auth PlatformでBranding、Audience、Data Accessを設定する
2. Data Accessには`openid`、メールアドレス、プロフィールの基本スコープを設定する
3. Clientsで種類が「Web application」のOAuth Clientを作成する
4. Authorized JavaScript originsへ本番オリジンと開発オリジンを登録する
5. Authorized redirect URIsへSupabase Dashboardに表示されるCallback URLを登録する
6. Client IDとClient SecretをSupabaseのGoogle Providerへ登録する

SupabaseのCallback URLは通常、次の形式になる。

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Googleの基本設定は[Supabase公式のGoogleログイン設定](https://supabase.com/docs/guides/auth/social-login/auth-google)も参照する。

## Supabase Authの設定

Supabase Dashboardで次を設定する。

- Authentication → Providers → Google：有効
- Client ID／Client Secret：Google Cloudで発行した値
- Site URL：本番アプリURL
- Redirect URLs：本番アプリURLとローカル開発URL

ローカル開発では、実際にブラウザで使うオリジンを登録する。例：

```text
http://localhost:5173
http://127.0.0.1:5173
```

OAuth Client SecretとSupabase Secret keyはブラウザ、Git、CloudflareのBuild variablesへ
含めない。Supabase Secret keyはWorkerのSecretとしてだけ保持する。

## 店舗コード

店舗コードは、Googleログインした利用者が申請先店舗を指定するために使う。
コードを知っていても管理者の承認前は商品データへアクセスできない。

英大文字・数字6文字の値を生成し、スタッフにはコード本体を案内する。読み間違いを避けるため、
`I`、`O`、`0`、`1`は使用しない。入力された小文字はシステム側で大文字へ変換する。
データベースにはコード本体ではなく、小文字16進数のSHA-256ハッシュだけを登録する。

6文字にしているのは、このコードだけでは商品データへアクセスできず、Googleログインと
店舗管理者の承認が別途必要だからである。承認待ちに心当たりのない申請があれば却下する。

macOSでの生成例：

```bash
LC_ALL=C tr -dc 'A-HJ-NP-Z2-9' < /dev/urandom | head -c 6
printf '%s' '生成した6文字の店舗コード' | shasum -a 256
```

出力された64文字のハッシュを登録する。

```sql
insert into store_registration_codes (store_id, code_hash)
values ('店舗UUID', '店舗コードのSHA-256')
on conflict (store_id)
do update set
  code_hash = excluded.code_hash,
  updated_at = now();
```

この更新で古い店舗コードは使用できなくなる。コードを紛失・漏えいした場合も同じ手順で更新する。

## 最初の店舗管理者を登録する

最初の管理者は、自分自身を承認できないためシステム運用者が登録する。

1. 対象者が本番アプリで一度「Googleでログイン」を行う
2. 初回利用申請画面または承認待ち画面まで進む
3. Supabase SQL EditorでGoogleアカウントのユーザーUUIDと店舗UUIDを確認する

```sql
select id, email, created_at
from auth.users
order by created_at desc;

select store_id, company_name, store_name
from stores;
```

4. 対象ユーザーへ店舗管理者権限を付与する

```sql
update profiles
set
  last_name = '管理者の姓',
  first_name = '管理者の名',
  updated_at = now()
where user_id = 'AuthユーザーUUID';

insert into store_memberships (store_id, user_id, role, is_active)
values ('店舗UUID', 'AuthユーザーUUID', 'admin', true)
on conflict (store_id, user_id)
do update set
  role = 'admin',
  is_active = true,
  disabled_at = null,
  updated_at = now();

update store_access_requests
set
  status = 'approved',
  reviewed_at = now(),
  updated_at = now()
where
  store_id = '店舗UUID'
  and user_id = 'AuthユーザーUUID';
```

利用申請前に直接管理者登録した場合、最後の`update store_access_requests`は0件更新で問題ない。
対象者は画面を再読み込みすると管理者として利用できる。

## 2人目以降の店舗管理者を登録する

店舗管理者は管理画面から別の利用者を`admin`へ昇格できない。追加する対象者に一度Googleログイン
してもらい、「最初の店舗管理者を登録する」と同じ`store_memberships`のSQLで`admin`を付与する。
スタッフ数が少ない間はシステム運用者がこの操作を行い、管理者権限の誤付与を防ぐ。

## システム管理者を登録する

店舗オーナーなど通常の管理者には設定しない。システム全体を運用するアカウントだけを登録する。
先に、前節と同じ方法で対象店舗の`admin` membershipを作成する。

```sql
insert into system_admins (user_id)
values ('AuthユーザーUUID')
on conflict (user_id) do nothing;
```

## スタッフの日常登録フロー

1. スタッフが「Googleでログイン」を押す
2. 初回だけ姓、名、店舗コードを入力して利用申請する
3. 店舗管理者が「管理 → 利用申請」で承認または却下する
4. スタッフが「承認状況を確認」を押す
5. 承認済みの場合、商品一覧を利用できる

却下されたスタッフは入力内容を直して再申請できる。管理者側から「承認待ちに戻す」こともできる。
利用停止されたスタッフは再申請できず、再開にはシステム運用者によるmembershipの再有効化が必要である。

```sql
update store_memberships
set
  is_active = true,
  disabled_at = null,
  updated_at = now()
where
  store_id = '店舗UUID'
  and user_id = 'AuthユーザーUUID'
  and role = 'staff';
```

## プロフィールとログアウト

- 姓・名：本人がプロフィール画面から変更できる
- Googleメールアドレス：参照専用。変更・復旧はGoogleアカウント側で行う
- 権限・所属店舗：本人は変更できない
- 通常ログアウト：現在のブラウザのセッションだけを終了する

## ログイン状態の保持

エンドユーザーが頻繁にログインし直さなくてよいことを優先し、セッションは原則として
期限を設けず保持する。Supabaseのアクセストークン（JWT）は標準の1時間で失効するが、
Webアプリがブラウザに保存した更新用トークンを使って自動更新するため、通常の操作では
再ログインは発生しない。

Supabase DashboardのAuthentication → Sessionsは次の方針にする。

| 設定 | 推奨値 | 理由 |
|---|---|---|
| JWT expiry | 標準の1時間 | 短時間トークンを自動更新する。ログイン頻度には影響しない |
| Time-box user sessions | 設定しない | 一定日数ごとの強制ログインを行わない |
| Inactivity timeout | 設定しない | 利用頻度が低いスタッフもログイン状態を維持する |
| Single session per user | 無効 | 同じスタッフがスマートフォンとPCを併用できるようにする |

Supabaseでは標準設定のセッションは、ログアウトなどで終了するまで有効である。Time-box、
Inactivity timeout、Single sessionの制限設定はProプラン以上で利用できるが、現在の少人数運用では
設定しない。[Supabase公式のセッション仕様](https://supabase.com/docs/guides/auth/sessions)も参照する。

通常、次の場合に再ログインが必要になる。

- 本人がログアウトした
- ブラウザのサイトデータを削除した
- シークレット／プライベートブラウズを終了した
- 新しい端末または別のブラウザを使った
- Supabase側でセッションを失効させた
- 保存されたセッション情報が破損・失効した

アプリを閉じる、ブラウザのタブを閉じる、端末を再起動するだけでは通常ログアウトされない。
通常ログアウトは`local` scopeを使い、操作した端末だけをログアウトする。

退職、端末紛失、不正利用の疑いがある場合は、長いセッション期限に頼らず、管理者が対象スタッフを
利用停止にする。商品DBのRLSとWorker APIは操作時に有効な店舗所属を確認するため、ブラウザに
Supabaseセッションが残っていても、利用停止後は商品データへアクセスできない。

## 本番切り替え順序

`0006_auth_roles_and_item_editors.sql`は匿名アクセスを削除するため、Googleログイン対応のWebと
Workerより先に適用すると、現在公開中の画面から商品データへアクセスできなくなる。
mainへ反映するまでは適用しない。

本番切り替えは短いメンテナンス時間を設け、次の順序で行う。

1. データベースのバックアップを確認する
2. Google CloudとSupabaseのGoogle Provider、Site URL、Redirect URLsを設定する
3. WebのBuild variablesとWorkerのSecretsを確認する
4. `0006_auth_roles_and_item_editors.sql`を適用する
5. Googleログイン対応のWebとWorkerを続けてデプロイする
6. 最初の店舗管理者とシステム管理者を登録する
7. 管理者、スタッフの順で実機ログインを確認する

Google CloudとSupabase AuthのOAuth設定だけは先に準備してよい。ただし、マイグレーションと
認証必須Workerのデプロイは、Webの本番反映と同じ切り替え作業内で行う。

## ローカルUI確認

SupabaseやGoogle OAuthへ接続せず各画面を確認する場合は、`apps/web/.env.local`へ次を設定する。

```text
VITE_UI_PREVIEW_MODE=all
```

`pnpm dev:web`で起動し、`/#/`を開くと商品一覧・メニュー、ログイン、初回登録、管理者、プロフィールの
プレビュー一覧を表示する。各画面で行った操作はSupabaseへ送信されない。
このモードはViteの開発実行時だけ有効で、本番ビルドでは認証を迂回しない。
