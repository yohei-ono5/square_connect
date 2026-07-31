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

## 現在の実装

商品本体と商品バリエーションの両方へ`present_at_all_locations: true`を設定している。
このため、新規商品はSquareの全ロケーションで利用可能になり、POSにも表示される。
ECサイトへの公開や、配送・店舗受取などのオンライン販売設定は制御していない。

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

## 推奨する次の実装

1. Squareの有効なロケーション一覧を取得するAPIをWorkerへ追加する。
2. 商品登録・編集画面に「POSで販売する店舗」の複数選択を追加する。
3. 選択したSquareロケーションIDをSupabaseへ保存する。
4. ECについては「Square登録後、Square DashboardでEC公開設定が必要」と画面に表示する。
5. Squareがチャネル割り当てAPIを公開した段階で、POSのみ・ECのみ・両方の3択へ拡張する。

仮想ロケーションをECサイトとして選択する方法は、Square Onlineへの商品公開や
フルフィルメント設定と同義ではないため、EC選択の代替としては使用しない。
