# kana-pinyin

Bilingual IME demo — auto-detecting Chinese (pinyin) and Japanese (romaji) input in a single pipeline.

## Architecture

```
User input (roman string)
    │
    ▼
┌─────────────────────────────────┐
│  Language detector              │
│  Try pinyin split vs romaji split │
│  Pick the one that fully matches  │
└────────────┬────────────────────┘
             │
     ┌───────┴───────┐
     ▼               ▼
┌─────────┐   ┌──────────────┐
│ Chinese │   │ Japanese     │
│ dict    │   │ karukan      │
│ pipeline│   │ (neural IME) │
└─────────┘   └──────────────┘
     │               │
     ▼               ▼
  Candidates     Candidates
  (RIME dict)    (kana-kanji conv)
     │               │
     └───────┬───────┘
             ▼
      Candidate list
      → select → commit
```

### Chinese pipeline

- **Dictionary**: RIME word dictionaries ([rime-ice](https://github.com/iDvel/rime-ice)) — ~1.8M entries
- **Segmentation**: DP-style search over all possible word boundaries
- **Scoring**: Fewer segments (longer word matches) preferred; ties broken by word frequency
- **Fuzzy matching**: `lu`↔`lv` (ü), `nu`↔`nv` for user input vs dictionary keys

### Japanese pipeline

- **Engine**: [karukan](https://github.com/togatoga/karukan) — neural kana-kanji conversion via llama.cpp
- **Protocol**: JSON-RPC 2.0 over stdio (`karukan-imserver`)
- **Models**: jinen-v1-small (Q5_K_M) + jinen-v1-xsmall (auto-downloaded on first run)
- **Romaji styles**: Hepburn, Nihon-shiki, Kunrei-shiki all supported

### Language detector

The detector tries splitting the input with both syllable tables:
- **Pinyin table**: ~400 syllables (a, ai, an, ang, ba, bai, ban, ...)
- **Romaji table**: ~100 syllables (a, ka, ki, ku, sha, chi, tsu, ...)

When both match (e.g. `ni` is valid in both), feature scoring decides:
- Romaji-specific syllables (`chi`, `tsu`, `shi`, `fu`, `ji`, ...) → Japanese
- Pinyin-specific patterns (`zh`, `ch`, `sh` initials, `ng` finals, `q`, `v`) → Chinese

Usually 3-4 characters are enough to determine the language.

## Setup

### Prerequisites

- [Deno](https://deno.land/) (v1.38+)
- [Rust/Cargo](https://www.rust-lang.org/) (to build karukan-imserver)
- ~50MB disk for dictionaries, ~200MB for karukan models (auto-downloaded)

### Install

```bash
git clone git@github.com:CheerChen/kana-pinyin.git
cd kana-pinyin

# Download RIME dictionaries (~44MB)
./scripts/download_dicts.sh

# Build karukan-imserver (Japanese pipeline)
git clone https://github.com/togatoga/karukan.git ../karukan
cd ../karukan && cargo build --release -p karukan-im && cd ../kana-pinyin
```

## Usage

```bash
# Start the bilingual REPL
deno task repl

# Or specify karukan-imserver path explicitly
deno run -A src/repl.ts /path/to/karukan-imserver
```

### Interactive commands

```
> nihao              ← type roman string, Enter to get candidates
  Detected: Chinese (pinyin)
  Candidates:
    0: 你好
    1: 拟好

> 0                  ← select candidate by number
  >> Committed: 你好

> konnnichiha        ← Japanese is auto-detected
  Detected: Japanese (romaji)
  Candidates:
    0: こんにちは
    1: 今日は

> 1                  ← select 今日は
  >> Committed: 今日は

> c                  ← clear buffer
> q                  ← quit
```

## Project structure

```
kana-pinyin/
├── src/
│   ├── repl.ts                  # Interactive REPL entry point
│   ├── detector/
│   │   └── lang_detect.ts       # Language detector (pinyin vs romaji)
│   ├── pinyin/
│   │   └── dict_lookup.ts       # Chinese dictionary pipeline
│   ├── japanese/
│   │   └── karukan_client.ts    # Japanese karukan-imserver client
│   └── key_map/                 # Pinyin syllable tables (from lime)
│       ├── pinyin/
│       │   ├── keys_to_pinyin.ts
│       │   ├── all_pinyin.ts
│       │   ├── fuzzy_pinyin.ts
│       │   └── ...
│       ├── rime_dict.ts
│       └── zi_ind.ts
├── dicts/                       # RIME dictionaries (gitignored)
│   ├── base.dict.yaml
│   ├── ext.dict.yaml
│   ├── tencent.dict.yaml
│   └── 8105.dict.yaml
├── scripts/
│   └── download_dicts.sh        # Download RIME dictionaries
├── deno.json
└── README.md
```

## Acknowledgments

- [lime](https://github.com/rime-fun/lime) — pinyin segmentation logic (`key_map/pinyin/`)
- [rime-ice](https://github.com/iDvel/rime-ice) — RIME dictionaries
- [karukan](https://github.com/togatoga/karukan) — Japanese neural IME engine

## License

MIT
