#!/usr/bin/env bash
# Изолированная проверка возможной схемы переключения каталогов, НЕ деплой.
set -euo pipefail
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/old" "$root/new" "$root/data" "$root/uploads"
printf old >"$root/old/version"
printf new >"$root/new/version"
printf important >"$root/data/queue"
printf media >"$root/uploads/media"
ln -s old "$root/current"
swap() {
	ln -s "$1" "$root/next"
	mv -Tf "$root/next" "$root/current"
}
assert_old() {
	test "$(cat "$root/current/version")" = old
	test "$(cat "$root/data/queue")" = important
	test "$(cat "$root/uploads/media")" = media
}
# Сбой предварительной проверки не меняет ссылку.
if test -f "$root/missing"; then swap new; fi
assert_old
# Сбой проверки новой версии: атомарно вернуть старую ссылку.
swap new
test "$(cat "$root/current/version")" = new
if ! test -f "$root/new/healthy"; then swap old; fi
assert_old
# Успешное переключение сохраняет данные и медиа.
touch "$root/new/healthy"
swap new
test "$(cat "$root/current/version")" = new
test "$(cat "$root/data/queue")" = important
test "$(cat "$root/uploads/media")" = media
printf '%s\n' 'PASS preflight failure, rollback and success; isolated files only'
