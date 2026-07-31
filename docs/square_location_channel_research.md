# Squareの店舗・販売チャネル調査

調査日: 2026-07-31  
対象Square APIバージョン: 2026-07-15

## 結論

Squareの商品を表示する「店舗（ロケーション）」はCatalog APIで制御できる。
一方、Square Onlineなどの「販売チャネル」は取得できるが、CatalogItemの`channels`が
読み取り専用のため、公式APIから商品を任意のチャネルへ公開・非公開にすることはできない。

したがって、現時点の公式APIだけでは次の3択を完全には実装できない。

- 店舗のPOSレジのみ
- ECサイトのみ
- 店舗のPOSレジとECサイトの両方

現在はSquare Dashboardの商品初期設定からオンラインチャネル
「Rosso&Nero（赤と黒の店）」を外している。この初期設定により、新規商品はPOSレジだけで
利用し、ECサイトへは自動掲載しない。EC掲載が必要な商品だけ、登録後にSquare Dashboardで
オンラインチャネルを追加する。

## 現在の実装

商品本体と商品バリエーションの両方へ`present_at_all_locations: true`を設定している。
このため、新規商品はSquareの全ロケーションで利用可能になり、POSにも表示される。
この値はSquareのロケーション設定であり、ECサイトへの公開や、配送・店舗受取などの
オンライン販売設定は制御しない。ECへの自動掲載を防ぐのはSquare Dashboard側の
「商品の初期設定」である。

## 店舗（ロケーション）

CatalogObjectには次の書き込み可能なフィールドがある。

- `present_at_all_locations`
- `present_at_location_ids`
- `absent_at_location_ids`

Locations APIの`GET /v2/locations`で有効な店舗を取得し、商品登録画面で選択した
SquareロケーションIDを`present_at_location_ids`へ設定すれば、POSで利用できる店舗を限定できる。

実装する場合は商品本体と商品バリエーションへ同じロケーション設定を適用し、
Supabaseにも選択したSquareロケーションIDを保存する。

## 販売チャネル

Channels API（Beta）の`GET /v2/channels`で、店舗やSquare Onlineを含むチャネル情報を取得できる。
ただし、Channels APIには一覧・一括取得・個別取得しかなく、商品をチャネルへ割り当てる更新APIはない。

CatalogItemの`channels`も読み取り専用である。Square Onlineへの公開状態やオンラインの
フルフィルメント方法をCatalog APIから設定することはできないため、EC公開はSquare Dashboardで
手動設定する必要がある。

Channels APIはSandboxでは利用できないため、検証用の本番アカウントでのみ調査・確認できる。

## 確定した運用

1. Squareの商品初期設定では、オンラインチャネルを未選択のまま維持する。
2. このアプリから商品を登録し、Square側でPOSレジのみ（チャネル1/2）になったことを確認する。
3. EC掲載が必要な商品だけ、Square Dashboardの商品詳細または一括編集でECチャネルを追加する。
4. 初期設定変更前の既存商品は自動変更されないため、Square Dashboardで必要なチャネルへ修正する。
5. Squareがチャネル割り当ての更新APIを公開した段階で、アプリからの切り替えを検討する。

将来アプリ上にチャネル状態を表示する場合は、Channels APIとCatalogItemの読み取り値を利用する。
取得に失敗した状態を「非掲載」と誤表示せず、「取得できません」と明示する。

仮想ロケーションをECサイトとして選択する方法は、Square Onlineへの商品公開や
フルフィルメント設定と同義ではないため、EC選択の代替としては使用しない。
