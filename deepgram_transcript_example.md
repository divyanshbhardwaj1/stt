# Deepgram output, as it actually arrives

One real call, so this is the response shape the code reads - not a mock.

| | |
|---|---|
| endpoint | `POST https://api.deepgram.com/v1/listen` |
| params | `model=nova-3`, `language=multi`, `smart_format=false`, `punctuate=false` |
| body | the audio file itself, raw bytes |
| clip here | 20s taken from a real inspection |
| returned | 45 words over 20.088s |

Deepgram splits nothing. It returns a flat list of words, each with a start
and an end in seconds. Every snippet boundary in the audit sheet is worked out
from this list by `services/playback.py`; the clip is never cut server-side.

---

## 1. The raw response, verbatim

```json
{
  "metadata": {
    "transaction_key": "deprecated",
    "request_id": "01a0aa4e-372d-79d0-a68d-d4fed4602ec0",
    "sha256": "6627606956580e672186d14ec3e771d68304acfc1468e926d1cfaa00c83a1588",
    "created": "2026-09-16T13:00:48.556Z",
    "duration": 20.088,
    "channels": 1,
    "models": [
      "b6e78fa4-ac4f-4f32-93f0-2b6906832fb5"
    ],
    "model_info": {
      "b6e78fa4-ac4f-4f32-93f0-2b6906832fb5": {
        "name": "general-nova-3",
        "version": "2026-01-27.9107",
        "arch": "nova-3"
      }
    }
  },
  "results": {
    "channels": [
      {
        "alternatives": [
          {
            "transcript": "sorry we just we just which size should we do extra small a small small give us small small size basement height one and quarter size small okay waistband elastic height one three by eight okay waist relaxed at top as twenty eight three quart",
            "confidence": 0.9086914,
            "languages": [
              "en"
            ],
            "words": [
              {
                "word": "sorry",
                "start": 0.32,
                "end": 1.52,
                "confidence": 0.7468262,
                "language": "en"
              },
              {
                "word": "we",
                "start": 1.52,
                "end": 1.8399999,
                "confidence": 0.83251953,
                "language": "en"
              },
              {
                "word": "just",
                "start": 1.8399999,
                "end": 2.08,
                "confidence": 0.9790039,
                "language": "en"
              },
              {
                "word": "we",
                "start": 2.08,
                "end": 2.48,
                "confidence": 0.9589844,
                "language": "en"
              },
              {
                "word": "just",
                "start": 2.48,
                "end": 2.8,
                "confidence": 0.9873047,
                "language": "en"
              },
              {
                "word": "which",
                "start": 3.12,
                "end": 3.7599998,
                "confidence": 0.79541016,
                "language": "en"
              },
              {
                "word": "size",
                "start": 3.9199998,
                "end": 4.16,
                "confidence": 0.4555664,
                "language": "en"
              },
              {
                "word": "should",
                "start": 4.16,
                "end": 4.3199997,
                "confidence": 0.29663086,
                "language": "en"
              },
              {
                "word": "we",
                "start": 4.3199997,
                "end": 4.4,
                "confidence": 0.9448242,
                "language": "en"
              },
              {
                "word": "do",
                "start": 4.4,
                "end": 4.72,
                "confidence": 0.6694336,
                "language": "en"
              },
              {
                "word": "extra",
                "start": 4.72,
                "end": 5.04,
                "confidence": 0.67285156,
                "language": "en"
              },
              {
                "word": "small",
                "start": 5.04,
                "end": 5.44,
                "confidence": 0.89453125,
                "language": "en"
              },
              {
                "word": "a",
                "start": 5.44,
                "end": 5.52,
                "confidence": 0.69140625,
                "language": "en"
              },
              {
                "word": "small",
                "start": 5.52,
                "end": 5.7599998,
                "confidence": 0.8088379,
                "language": "en"
              },
              {
                "word": "small",
                "start": 5.7599998,
                "end": 6.08,
                "confidence": 0.7590332,
                "language": "en"
              },
              {
                "word": "give",
                "start": 6.08,
                "end": 6.24,
                "confidence": 0.26391602,
                "language": "en"
              },
              {
                "word": "us",
                "start": 6.24,
                "end": 6.64,
                "confidence": 0.53222656,
                "language": "en"
              },
              {
                "word": "small",
                "start": 6.64,
                "end": 7.52,
                "confidence": 0.8486328,
                "language": "en"
              },
              {
                "word": "small",
                "start": 7.52,
                "end": 8.8,
                "confidence": 0.87158203,
                "language": "en"
              },
              {
                "word": "size",
                "start": 8.8,
                "end": 9.44,
                "confidence": 0.7451172,
                "language": "en"
              },
              {
                "word": "basement",
                "start": 9.5199995,
                "end": 10.0,
                "confidence": 0.9423828,
                "language": "en"
              },
              {
                "word": "height",
                "start": 10.0,
                "end": 10.559999,
                "confidence": 0.94108075,
                "language": "en"
              },
              {
                "word": "one",
                "start": 10.559999,
                "end": 10.719999,
                "confidence": 1.0,
                "language": "en"
              },
              {
                "word": "and",
                "start": 10.719999,
                "end": 10.96,
                "confidence": 0.94628906,
                "language": "en"
              },
              {
                "word": "quarter",
                "start": 10.96,
                "end": 11.44,
                "confidence": 0.8796387,
                "language": "en"
              },
              {
                "word": "size",
                "start": 11.44,
                "end": 11.759999,
                "confidence": 0.87630206,
                "language": "en"
              },
              {
                "word": "small",
                "start": 11.759999,
                "end": 12.32,
                "confidence": 0.99902344,
                "language": "en"
              },
              {
                "word": "okay",
                "start": 12.32,
                "end": 12.719999,
                "confidence": 0.99853516,
                "language": "en"
              },
              {
                "word": "waistband",
                "start": 13.692937,
                "end": 14.252937,
                "confidence": 0.7882487,
                "language": "en"
              },
              {
                "word": "elastic",
                "start": 14.252937,
                "end": 14.732937,
                "confidence": 0.99560547,
                "language": "en"
              },
              {
                "word": "height",
                "start": 14.732937,
                "end": 15.132937,
                "confidence": 0.9954427,
                "language": "en"
              },
              {
                "word": "one",
                "start": 15.132937,
                "end": 15.292937,
                "confidence": 1.0,
                "language": "en"
              },
              {
                "word": "three",
                "start": 15.292937,
                "end": 15.452937,
                "confidence": 0.9086914,
                "language": "en"
              },
              {
                "word": "by",
                "start": 15.452937,
                "end": 15.692937,
                "confidence": 0.9970703,
                "language": "en"
              },
              {
                "word": "eight",
                "start": 15.692937,
                "end": 16.252937,
                "confidence": 1.0,
                "language": "en"
              },
              {
                "word": "okay",
                "start": 16.412937,
                "end": 17.052937,
                "confidence": 0.99853516,
                "language": "en"
              },
              {
                "word": "waist",
                "start": 17.292938,
                "end": 17.692938,
                "confidence": 0.95654297,
                "language": "en"
              },
              {
                "word": "relaxed",
                "start": 17.692938,
                "end": 18.252937,
                "confidence": 0.78222656,
                "language": "en"
              },
              {
                "word": "at",
                "start": 18.252937,
                "end": 18.492937,
                "confidence": 0.99316406,
                "language": "en"
              },
              {
                "word": "top",
                "start": 18.492937,
                "end": 18.732937,
                "confidence": 0.9892578,
                "language": "en"
              },
              {
                "word": "as",
                "start": 18.732937,
                "end": 18.892937,
                "confidence": 0.56933594,
                "language": "en"
              },
              {
                "word": "twenty",
                "start": 18.892937,
                "end": 19.292938,
                "confidence": 0.9941406,
                "language": "en"
              },
              {
                "word": "eight",
                "start": 19.292938,
                "end": 19.612938,
                "confidence": 0.99121094,
                "language": "en"
              },
              {
                "word": "three",
                "start": 19.612938,
                "end": 19.852938,
                "confidence": 0.8198242,
                "language": "en"
              },
              {
                "word": "quart",
                "start": 19.852938,
                "end": 20.092937,
                "confidence": 0.5374756,
                "language": "en"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

## 2. What the code keeps

`services/timing.py` reduces the above to `{duration, words:[{w, s, e}]}` and caches it
at `data/transcripts/<stem>.words.json`. Per-word `confidence` and `language` are
currently discarded - see the note at the end.

```json
{
 "duration": 20.088,
 "words": [
  {
   "w": "sorry",
   "s": 0.32,
   "e": 1.52
  },
  {
   "w": "we",
   "s": 1.52,
   "e": 1.8399999
  },
  {
   "w": "just",
   "s": 1.8399999,
   "e": 2.08
  },
  {
   "w": "we",
   "s": 2.08,
   "e": 2.48
  },
  {
   "w": "just",
   "s": 2.48,
   "e": 2.8
  },
  {
   "w": "which",
   "s": 3.12,
   "e": 3.7599998
  },
  {
   "w": "size",
   "s": 3.9199998,
   "e": 4.16
  },
  {
   "w": "should",
   "s": 4.16,
   "e": 4.3199997
  },
  {
   "w": "we",
   "s": 4.3199997,
   "e": 4.4
  },
  {
   "w": "do",
   "s": 4.4,
   "e": 4.72
  },
  {
   "w": "extra",
   "s": 4.72,
   "e": 5.04
  },
  {
   "w": "small",
   "s": 5.04,
   "e": 5.44
  }
 ]
}
```

---

## 3. A real inspection index

`data/transcripts/7122(4).words.json` - 2427 words over 1622s.
First 30 words, which is the spoken preamble before any measuring starts:

```
mobile से रखा हुआ था तुम बराबर है don't go by बराबर i will go with this now only i understand but you are going to read the information that
```

And around 481s, where the ACROSS SHOULDER reading sits:

```
across[481.3] shoulder[481.7] seam[482.3] to[482.5] seam[482.7] relaxed[483.2] yes[483.9] thirteen[484.4] okay[485.9] across[488.0] front[488.6] position[488.9] from[489.5] hps[489.9] five[490.3] to[490.7] five[491.5] eleven[492.3] five[492.7] by[492.9] eight[493.1] minus[495.7] one[496.1] by[496.3] eight[496.5] across[499.0] back[499.4] position[499.7]
```

---

## Note: two fields we throw away

Every word carries `confidence` and `language`:

```json
{"word": "sorry", "start": 0.32, "end": 1.52, "confidence": 0.7468262, "language": "en"}
```

`language` is per word, which is directly relevant here - these recordings
switch between Hindi and English mid-sentence, and the matcher currently has
no idea which words it is looking at. `confidence` would let a snippet say how
well the words behind it were heard. Neither is used today.
