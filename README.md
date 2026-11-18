# btc-race-24h-20261118-1444 — STABLE-DIP bot (siap submit)

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Yami-euy/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Yami-euy/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Bounty: Race a BTC trading bot live for 24 hours — $250, top 10 dibayar
(1st $60, 2nd $40, 3rd $30, 4th $25, 5th $20, 6–10 $15).
**Deadline: 2026-11-19 03:44 WIB.** Entry via repo GitHub publik (source bundle
tidak bisa di bounty ini). Repo harus dibuat SETELAH kompetisi dibuka
(2026-11-18 21:44 WIB) — repo lama btc-race-bot (dibuat 2026-11-17) tidak bisa
dipakai lagi. Nama repo di badge di atas: btc-race-24h-20261118-1444.

## Strategi (kode sendiri, bukan copy baseline)

Stabilised dip-buy, long only, maks 1 posisi:

- Dip diukur terhadap rolling high 240 bar (4 jam). Entry pertama (90% cash)
  hanya setelah dip berhenti jatuh: close harus reclaim ≥8 bps dari running
  dip low. Bounce 5 bar yang lama (BOUNCE v3) masuk terlalu dini di dead-cat
  bounce; reclaim dari low menunggu belokan beneran.
- Tranche kedua (sisa 10% cash) hanya kalau dip makin dalam ke ≤−190 bps
  DAN sudah stabil juga — beli kaki kedua di harga yang lebih bagus, bukan
  averaging down saat masih jatuh.
- Take-profit bertingkat: entry dalam (dip ≥−180 bps) boleh jalan ke +210 bps
  (V pagi yang besar bayar seharian — RECLAIM 8 masuk lebih murah jadi puncak
  +216 bps di atas cost); tier tengah (dip ≥−140 bps) bank +75 bps; entry
  dangkal bank +60 bps cepat. TP 200 pernah gagal di ronde 1 karena entry
  RECLAIM 15 lebih mahal (puncak cuma +185 bps di atas cost).
- Regime filter: tidak ada entry baru saat return 6 jam di bawah −25 bps
  (sore hari di dev window isinya dip dangkal yang recovery-nya cuma ~30 bps
  lalu lanjut turun — beli itu sama dengan balikin profit pagi).
- Stop −120 bps dari blended cost, max-hold 420 bar untuk posisi basi.
- Max slippage 100 bps; maks 1 order per bar; deterministik (float64 dari
  closes saja, tanpa wall clock / network / random).

## Hasil grade lokal (kit resmi, `grade-local --driver process`)

Diperiksa 2026-11-18 ~23:52 WIB, dua eksekusi, L1 regrade reproduced byte for byte:

- **Net PnL dev window: +25,297768 USDC (+2,53%) — lolos dev gate (PnL > 0)**
- 6 trades (3 round trip, semuanya menang), win rate 100%, max drawdown 0,64%
- Fees 1,544545 USDC; PnL di 2x fees masih +23,743377 USDC
- Guardrails terpenuhi (≥1 trade, drawdown ≤25%)
- action_log_sha256: 306039d66b577e717107134b374acacf19de04d4f301592ce04be763b791b95c
  (hash lokal proses-driver; hash server akan beda karena sandbox/docker + node v26)

Perbandingan: BOUNCE v3 di dev window yang sama +17,84 USDC (1 round trip);
bot juara race lama (strescco) +23,80 USDC di window ini. STABLE-DIP ronde 2
mengalahkan BOUNCE (+$7,46) dan juara (+$1,50) — RECLAIM 8 masuk V pagi
lebih murah, TP deep 210 kebuka, tier tengah +75 bps nangkep ayunan kedua.

## Tuning (log lengkap di btc-race-20261118-work/grades.md)

- v1 (TP 220, tranche 80/20, T2 mati karena bug control-flow): +$7,33.
- A (TP 200, tranche 100%): +$9,42 — TP 200 meleset $1,49 dari puncak.
- B (TP 180, tranche 100%): +$21,74.
- Plateau (hasil identik, bukan magic peak): TP_DEEP 170–180, TP_SHALLOW
  60–70, TRANCHE1 90–100%, DIP2 190–200. TP 200 dan tranche 80% tanpa T2
  (DIP2 220, T2 tidak pernah kena) masing-masing −$12 dan −$4,58.
- DIP1 80 menambah 1 trade kalah di sore hari (−$11,79, sim); regime −200
  juga menambah trade kalah yang sama — regime −25 dipertahankan.
- Bug yang ditemukan & diperbaiki saat tuning: blok exit `return []` sebelum
  entry membuat tranche kedua TIDAK PERNAH bisa jalan (dead code); setelah
  diperbaiki + T2 butuh stabilised juga, tranche 80/20 naik +$17,16 → +$20,63,
  dan 90/10 → **+$21,75 (dipilih)**.

## Kejujuran soal peluang

- Dev window ini hari TURUN (−2,80% buy-and-hold) dengan satu V pagi besar
  dan sore yang datar — setelah V praktis tidak ada lagi yang bisa ditangkap.
  Race window 24 jam setelah deadline BELUM terlihat siapa pun; hasil dev
  bukan janji hasil race. Jangan janjikan hadiah.
- Bot ini 3 round trip di dev window; kalau race window sepi dip, bisa jadi
  sedikit trade — tapi gate sudah lolos dan guardrail terpenuhi.

## Yang masih harus dilakukan main agent (JANGAN submit tanpa ini)

1. **GitHub sudah konek** — akun Yami-euy terverifikasi. Buat repo publik BARU
   di akun Yami-euy (dibuat setelah 2026-11-18 21:44 WIB), push isi direktori
   ini (main.ts, vendor/, LICENSE, README.md, .makefun/owner.json).
   `.makefun/owner.json` berisi wallet agen GQYsGjhCKHN6jRcv9mqgjRtUuvyQHd9NftekFxvsTQVC
   (wallet yang menandatangani entry; wallet utama akun F4DHSDTGxfXmMooUsWfbwPHr4s2iFpmCgEATD9oqo5NQ
   juga tertaut — kalau mau ganti, satu baris saja, karena pemilik repo GitHub
   sudah Yami-euy sendiri).
2. **Bundle transcripts + check di sesi main agent sendiri** sebelum submit
   (transcript gate: entry tanpa transcripts = tidak eligible hadiah;
   grade lokal di atas mencatat `eligible prize no (no_transcripts)`).
   Ikuti alur bounty lain: bundle dengan --prompt-file/--prompt-origin/
   --prompt-via + --system-prompt, lalu `check --kit . --repo <repo> --transcripts ...`.
3. **Preview ke Yami dulu, submit hanya setelah Yami bilang "gas"/konfirmasi**
   (aturan kerja Yami 2026-11-14). Kuota: 0 entry bounty ini, day cap 3
   (reset 2026-11-19 07:00 WIB).
4. Submit entry GitHub via makefun CLI, lalu cek dev grade server + rank.

## File

- `main.ts` — bot (TypeScript, Node 22 type-stripping, erasable syntax)
- `vendor/makefun-bars.ts` — copy byte-identik SDK kit (dikeluarkan dari
  authorship bila di bawah vendor/)
- `LICENSE` — MIT
- `.makefun/owner.json` — claim wallet Yami

---

<sub>Entered on [make.fun](https://make.fun/?ref=f72h35ke&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
