#!/bin/bash
# Hosted smoke test for ShopSmart. Usage: bash smoke-test.sh https://<host>
# Uses only fictional customers (@example.com). Creates 2 test accounts and 1 simulated order.
set -uo pipefail
BASE=${1:?usage: smoke-test.sh https://<host>}; API="$BASE/api"
T=$(mktemp -d); STAMP=$(date +%s | tail -c 6); PW='Fictional-pass-42'
pass=0; fail=0
check() { # name expected actual detail
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf 'PASS  %-46s %s\n' "$1" "$4"; else fail=$((fail+1)); printf 'FAIL  %-46s expected %s got %s %s\n' "$1" "$2" "$3" "$4"; fi; }
req() { # cookiejar method path [json] -> body in $T/body, prints status
  local jar=$1 m=$2 p=$3 d=${4:-}
  curl -s -o "$T/body" -w '%{http_code}' -D "$T/headers" ${jar:+-b "$T/$jar" -c "$T/$jar"} -X "$m" -H 'Content-Type: application/json' ${d:+--data "$d"} "$API$p"; }
J() { python3 -c "import json,sys; d=json.load(open('$T/body')); print($1)" 2>/dev/null; }

echo "ShopSmart hosted smoke test  $(date -u +'%Y-%m-%d %H:%M UTC')  $BASE"
s=$(curl -s -o "$T/body" -w '%{http_code}' "$API/health"); check "health over HTTPS" 200 "$s" "$(cat $T/body)"
s=$(curl -s -o /dev/null -w '%{http_code}' "http://${BASE#https://}/"); check "plain HTTP redirects to HTTPS" 308 "$s" ""
s=$(curl -s -o "$T/home" -w '%{http_code}' "$BASE/"); check "home page" 200 "$s" "$(grep -o '<title>[^<]*' $T/home)"
s=$(curl -s -o "$T/deep" -w '%{http_code}' "$BASE/products/2"); check "direct visit /products/2 (SPA rewrite)" 200 "$s" "$(grep -c 'id="root"' $T/deep) root div"
s=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/account"); check "direct visit /account" 200 "$s" ""
s=$(req "" GET /products); check "products load" 200 "$s" "$(J 'len(d["products"])') products"
s=$(req "" GET "/products?search=keyboard"); check "search keyboard" 200 "$s" "$(J '[p["name"] for p in d["products"]]')"
s=$(req "" GET "/products?search=drone"); check "search no match" "0" "$(J 'len(d["products"])')" "(HTTP $s)"
s=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://${BASE#https://}:3000/api/health"); check "port 3000 not public" 000 "$s" ""
s=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://${BASE#https://}:5432/"); check "port 5432 not public" 000 "$s" ""

ORDER='{"customerName":"Ana Test","email":"ana@example.com","address":"45 Fictional Ave, Test City","items":[{"productId":PID,"quantity":1}]}'
PID=$(curl -s "$API/products" | python3 -c "import json,sys; print([p['id'] for p in json.load(sys.stdin)['products'] if p['stock']>1][0])")
s=$(req "" GET /orders); check "guest GET /orders refused" 401 "$s" "$(J 'd["error"]["code"]')"
s=$(req "" POST /orders "${ORDER//PID/$PID}"); check "guest checkout refused" 401 "$s" ""
s=$(req ana POST /auth/register "{\"name\":\"Ana Test\",\"email\":\"ana.$STAMP@example.com\",\"password\":\"$PW\"}"); check "register Ana" 201 "$s" ""
cookie=$(grep -i '^set-cookie' $T/headers | tr -d '\r'); for f in HttpOnly Secure SameSite=Lax; do check "session cookie has $f" yes "$(echo "$cookie" | grep -qi "$f" && echo yes || echo no)" ""; done
s=$(req ben POST /auth/register "{\"name\":\"Ben Test\",\"email\":\"ben.$STAMP@example.com\",\"password\":\"$PW\"}"); check "register Ben" 201 "$s" ""
s=$(req ana POST /orders '{"customerName":"Ana Test","email":"not-an-email","address":"45 Fictional Ave, Test City","items":[{"productId":1,"quantity":1}]}'); check "invalid email refused" 422 "$s" "$(J 'list(d["error"]["details"]["fieldErrors"])')"
STOCK=$(curl -s "$API/products/$PID" | python3 -c "import json,sys; print(json.load(sys.stdin)['stock'])")
s=$(req ana POST /orders "{\"customerName\":\"Ana Test\",\"email\":\"ana@example.com\",\"address\":\"45 Fictional Ave, Test City\",\"items\":[{\"productId\":$PID,\"quantity\":$((STOCK+1))}]}")
[ $((STOCK+1)) -gt 20 ] && exp=422 || exp=409; check "excess quantity refused (stock $STOCK)" $exp "$s" "$(J 'd["error"]["code"]')"
s=$(req ana POST /orders "${ORDER//PID/$PID}"); OID=$(J 'd["id"]'); check "Ana places simulated order" 201 "$s" "order #$OID total $(J 'd["total"]')"
AFTER=$(curl -s "$API/products/$PID" | python3 -c "import json,sys; print(json.load(sys.stdin)['stock'])"); check "stock decremented by 1" $((STOCK-1)) "$AFTER" ""
s=$(req ana GET "/orders/$OID"); check "owner reads own order" 200 "$s" ""
s=$(req ana GET /orders); check "owner order list" 200 "$s" "$(J 'len(d)') order(s)"
s=$(req ben GET "/orders/$OID"); check "other customer denied (direct API)" 403 "$s" "$(J 'd["error"]["code"]')"
s=$(req ben GET /orders); check "other customer list excludes it" "0" "$(J 'len(d)')" ""
s=$(req "" POST /auth/login "{\"email\":\"ana.$STAMP@example.com\",\"password\":\"wrong-pass\"}"); check "wrong password refused" 401 "$s" "$(J 'd["error"]["code"]')"
s=$(req ana POST /auth/logout); check "logout" 204 "$s" ""
s=$(req ana GET /orders); check "after logout, orders refused" 401 "$s" ""
s=$(req "" POST /assistant/questions '{"question":"Which keyboard is below ₱2,000?"}'); check "assistant supported question" 200 "$s" "$(J '[p["name"] for p in d["recommendedProducts"]], d["mode"], d["sources"][0]["href"] if d["sources"] else None')"
s=$(req "" POST /assistant/questions '{"question":"Do you sell drones?"}'); check "assistant honest no match" "0" "$(J 'len(d["recommendedProducts"])')" "$(J 'd["mode"]')"
s=$(req "" POST /assistant/questions '{"question":"hi"}'); check "assistant invalid input" 422 "$s" ""
for js in $(grep -o 'assets/[^"]*\.js' $T/home | sort -u); do curl -s "$BASE/$js" >> "$T/bundle.js"; done
hits=$(grep -cE 'postgresql://|DATABASE_URL|GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20}|localhost:3000' "$T/bundle.js"); check "no secrets / localhost in JS bundle" 0 "$hits" "($(wc -c < $T/bundle.js) bytes scanned)"
echo "RESULT: $pass passed, $fail failed"
