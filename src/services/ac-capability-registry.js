// Shared with desktop; generated from its registry source and config/ac-capabilities.json.
// Generated registry data is injected by scripts/generate_ac_capabilities.py.
// This resolver never uses a physical manufacturer to infer an encoder.
const AcCapabilityRegistry = (() => {
  const registry = {
  "schema_version": 1,
  "registry_version": "irremote-2.9.0-1",
  "library_version": "2.9.0",
  "reference": "https://github.com/crankyoldgit/IRremoteESP8266/tree/v2.9.0/src",
  "features": [
    "power",
    "temperature",
    "turbo",
    "quiet",
    "eco",
    "swing_vertical",
    "swing_horizontal",
    "sleep",
    "display",
    "filter",
    "clean",
    "beep",
    "timer",
    "i_feel"
  ],
  "aliases": {
    "MIDEA_IR": "MIDEA",
    "MITSUBISHI": "MITSUBISHI_AC",
    "PANASONIC": "PANASONIC_AC",
    "SAMSUNG": "SAMSUNG_AC",
    "CARRIER": "CARRIER_AC64",
    "HAIER": "HAIER_AC",
    "HITACHI": "HITACHI_AC",
    "FUJITSU": "FUJITSU_AC",
    "TOSHIBA": "TOSHIBA_AC",
    "SHARP": "SHARP_AC",
    "WHIRLPOOL": "WHIRLPOOL_AC"
  },
  "protocols": {
    "TCL112AC": {
      "protocol": "TCL112AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": true,
        "filter": true,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 31,
        "step": 0.5,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {
        "1": "TAC09CHSD",
        "2": "GZ055BE1"
      },
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "eco",
        "display",
        "filter",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "DAIKIN": {
      "protocol": "DAIKIN",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": false,
        "filter": false,
        "clean": true,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 10,
        "max": 32,
        "step": 0.5,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "eco",
        "clean",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "DAIKIN2": {
      "protocol": "DAIKIN2",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": true,
        "filter": true,
        "clean": true,
        "beep": true,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 10,
        "max": 32,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        },
        "cool": {
          "min": 18
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "eco",
        "display",
        "filter",
        "clean",
        "beep",
        "sleep",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "DAIKIN64": {
      "protocol": "DAIKIN64",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": true,
        "display": false,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "power_toggle": true,
      "decode_fields": [
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "sleep",
        "swing_vertical"
      ]
    },
    "DAIKIN216": {
      "protocol": "DAIKIN216",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": false,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 10,
        "max": 32,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "GREE": {
      "protocol": "GREE",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": false,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": true,
        "display": true,
        "filter": false,
        "clean": true,
        "beep": false,
        "timer": false,
        "i_feel": true
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 1,
        "medium": 3,
        "high": 4
      },
      "fan_decode_aliases": {
        "1": "low",
        "2": "medium",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        },
        "auto": {
          "temperature_control": false,
          "fixed_temp": 25
        },
        "dry": {
          "fixed_fan": "low"
        }
      },
      "models": {
        "1": "YAW1F",
        "2": "YBOFB",
        "3": "YX1FSF"
      },
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "eco",
        "display",
        "clean",
        "sleep",
        "swing_vertical",
        "swing_horizontal",
        "i_feel"
      ]
    },
    "MIDEA": {
      "protocol": "MIDEA",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": true,
        "display": true,
        "filter": false,
        "clean": true,
        "beep": false,
        "timer": false,
        "i_feel": true
      },
      "temperature": {
        "min": 17,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "eco",
        "sleep",
        "swing_vertical"
      ]
    },
    "PANASONIC_AC": {
      "protocol": "PANASONIC_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": false,
        "filter": true,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {
        "1": "kPanasonicLke",
        "2": "kPanasonicNke",
        "3": "kPanasonicDke",
        "4": "kPanasonicJke",
        "5": "kPanasonicCkp",
        "6": "kPanasonicRkr"
      },
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "filter",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "SAMSUNG_AC": {
      "protocol": "SAMSUNG_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": true,
        "filter": true,
        "clean": true,
        "beep": true,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        },
        "auto": {
          "fixed_fan": "auto"
        }
      },
      "models": {},
      "model_rules": {},
      "notes": [
        "Sleep requires a duration; boolean sleep is not encoded by this profile."
      ],
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "eco",
        "display",
        "filter",
        "clean",
        "beep",
        "sleep",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "MITSUBISHI_AC": {
      "protocol": "MITSUBISHI_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": false,
        "quiet": true,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": false,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 31,
        "step": 0.5,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "quiet",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "CARRIER_AC64": {
      "protocol": "CARRIER_AC64",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": false,
        "quiet": false,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": true,
        "display": false,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "cool",
          "heat"
        ]
      },
      "modes": [
        "cool",
        "heat",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "sleep",
        "swing_vertical"
      ]
    },
    "FUJITSU_AC": {
      "protocol": "FUJITSU_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": false,
        "quiet": true,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": false,
        "display": false,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {
        "1": "ARRAH2E",
        "2": "ARDB1",
        "3": "ARREB1E",
        "4": "ARJW2",
        "5": "ARRY4",
        "6": "ARREW4E"
      },
      "model_rules": {
        "1": {
          "temperature": {
            "step": 0.25
          },
          "features": {
            "turbo": false,
            "eco": false,
            "swing_horizontal": true
          },
          "full_state_min_bits": 128
        },
        "2": {
          "temperature": {
            "step": 0.25
          },
          "features": {
            "turbo": false,
            "eco": false,
            "swing_horizontal": false
          },
          "full_state_min_bits": 120
        },
        "3": {
          "temperature": {
            "step": 0.25
          },
          "features": {
            "turbo": true,
            "eco": true,
            "swing_horizontal": false
          },
          "full_state_min_bits": 128
        },
        "4": {
          "temperature": {
            "step": 0.25
          },
          "features": {
            "turbo": false,
            "eco": false,
            "swing_horizontal": true
          },
          "full_state_min_bits": 120
        },
        "5": {
          "temperature": {
            "step": 0.25
          },
          "features": {
            "turbo": false,
            "eco": false,
            "swing_horizontal": true
          },
          "full_state_min_bits": 128
        },
        "6": {
          "temperature": {
            "step": 0.5
          },
          "features": {
            "turbo": false,
            "eco": false,
            "swing_horizontal": true
          },
          "full_state_min_bits": 128
        }
      },
      "requires_model": true,
      "full_state_min_bits": 128,
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "quiet",
        "eco",
        "filter",
        "clean",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "HAIER_AC": {
      "protocol": "HAIER_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": false,
        "quiet": false,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": true,
        "display": false,
        "filter": true,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "temp",
        "mode",
        "fan",
        "filter",
        "sleep",
        "swing_vertical"
      ]
    },
    "TOSHIBA_AC": {
      "protocol": "TOSHIBA_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": false,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": false,
        "display": false,
        "filter": true,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 17,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {
        "1": "kToshibaGenericRemote_B"
      },
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "eco",
        "filter"
      ]
    },
    "SHARP_AC": {
      "protocol": "SHARP_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": false,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": false,
        "display": true,
        "filter": true,
        "clean": true,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 15,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "cool",
          "heat"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        },
        "auto": {
          "temperature_control": false
        },
        "dry": {
          "temperature_control": false
        }
      },
      "models": {
        "1": "A907",
        "2": "A705",
        "3": "A903"
      },
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "eco",
        "display",
        "filter",
        "clean",
        "swing_vertical"
      ]
    },
    "HITACHI_AC": {
      "protocol": "HITACHI_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": false,
        "quiet": false,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": false,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 32,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "max": 5
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "max"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {},
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "swing_vertical",
        "swing_horizontal"
      ]
    },
    "WHIRLPOOL_AC": {
      "protocol": "WHIRLPOOL_AC",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": false,
        "eco": false,
        "swing_vertical": true,
        "swing_horizontal": false,
        "sleep": true,
        "display": true,
        "filter": false,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 18,
        "max": 30,
        "step": 1,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4
      },
      "fan_decode_aliases": {
        "1": "low",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        },
        "auto": {
          "temperature_control": false,
          "fixed_fan": "auto"
        }
      },
      "models": {
        "1": "DG11J13A",
        "2": "DG11J191"
      },
      "model_rules": {
        "1": {
          "temperature": {
            "min": 18,
            "max": 32
          }
        },
        "2": {
          "temperature": {
            "min": 16,
            "max": 30
          }
        }
      },
      "power_toggle": true,
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "display",
        "sleep",
        "swing_vertical"
      ]
    },
    "TEKNOPOINT": {
      "protocol": "TEKNOPOINT",
      "source": "IRremoteESP8266 2.9.0",
      "confidence": "library",
      "features": {
        "power": true,
        "temperature": true,
        "turbo": true,
        "quiet": true,
        "eco": true,
        "swing_vertical": true,
        "swing_horizontal": true,
        "sleep": false,
        "display": true,
        "filter": true,
        "clean": false,
        "beep": false,
        "timer": false,
        "i_feel": false
      },
      "temperature": {
        "min": 16,
        "max": 31,
        "step": 0.5,
        "unit": "C",
        "modes": [
          "auto",
          "cool",
          "heat",
          "dry"
        ]
      },
      "modes": [
        "auto",
        "cool",
        "heat",
        "dry",
        "fan"
      ],
      "fan_map": {
        "auto": 0,
        "low": 2,
        "medium": 3,
        "high": 4,
        "quiet": 1
      },
      "fan_decode_aliases": {
        "1": "quiet",
        "5": "high"
      },
      "mode_rules": {
        "fan": {
          "temperature_control": false
        }
      },
      "models": {
        "1": "TAC09CHSD",
        "2": "GZ055BE1"
      },
      "model_rules": {},
      "decode_fields": [
        "power",
        "temp",
        "mode",
        "fan",
        "turbo",
        "eco",
        "display",
        "filter",
        "swing_vertical",
        "swing_horizontal"
      ]
    }
  },
  "verified_models": {}
}
;
  const clone = value => JSON.parse(JSON.stringify(value));
  const featureNames = registry.features;
  const object = value => value && typeof value==='object' && !Array.isArray(value);
  function protocol(value) {
    const raw=typeof value==='string'?value:value?.control_snapshot?.observed_remote_protocol || value?.detected_protocol || value?.protocol_name || value?.protocol || '';
    const name=String(raw).trim().toUpperCase();
    return registry.aliases[name] || (registry.protocols[name]?name:'UNKNOWN');
  }
  function model(value) {
    if(!object(value))return null;
    const profile=value.capability_profile;
    if(profile?.protocol===protocol(value)&&profile.model_verified===true&&Number.isInteger(profile.remote_model))return profile.remote_model;
    const found=value.control_snapshot?.observed_remote_model ?? value.detected_remote_model ?? value.remote_model ?? profile?.remote_model;
    return Number.isInteger(found)&&found>0?found:null;
  }
  function merge(base, change) {
    if(!object(change))return base;
    for(const [key,value] of Object.entries(change)){
      if(object(value)&&object(base[key]))merge(base[key],value);else base[key]=clone(value);
    }return base;
  }
  function resolve(value) {
    const name=protocol(value), remoteModel=model(value), definition=registry.protocols[name];
    const empty={protocol:name,protocol_name:name,features:Object.fromEntries(featureNames.map(name=>[name,false])),temperature:null,modes:[],fan_map:{},mode_rules:{},models:{},source:'unknown',confidence:'unknown',unknown:true};
    const profile=definition?clone(definition):empty;
    if(definition&&remoteModel!==null&&profile.model_rules?.[remoteModel])merge(profile,profile.model_rules[remoteModel]);
    const saved=object(value?.capability_profile)?value.capability_profile:{};
    const matching=saved.protocol===name&&(!saved.remote_model || saved.remote_model===remoteModel);
    const verifiedModel=matching&&saved.model_verified===true&&saved.ac_model?.trim();
    if(verifiedModel){
      const exact=registry.verified_models[name+'|'+saved.ac_model+'|'+remoteModel];
      if(exact)merge(profile,exact);
    }
    const encoderFeatures={...profile.features};
    // Receiver reports can narrow unverified support, but cannot invent an encoder.
    const receiver=value?.control_snapshot?.observed_remote_capabilities;
    if(receiver&&protocol(value)===name){
      for(const feature of featureNames)if(receiver[feature]===false)profile.features[feature]=false;
      if(receiver.swing===false)profile.features.swing_vertical=false;
    }
    const statuses={};
    for(const feature of featureNames){
      const encoded=profile.features[feature]===true, manual=matching?saved.features?.[feature]:null;
      const verified=['verified_supported','verified_unsupported'].includes(manual?.status);
      statuses[feature]={status:verified?manual.status:encoded?'library_unverified':'unknown',
        source:verified?'physical_test':encoded?profile.source:'unknown',confidence:verified?'user_confirmed':encoded?'library':'unknown',
        encoded,verified_by:verified?manual.verified_by:null,verified_at:verified?manual.verified_at:null};
      profile.features[feature]=(encoded||verified&&manual.status==='verified_supported'&&encoderFeatures[feature]===true)&&manual?.status!=='verified_unsupported';
    }
    const options={};
    for(const [kind,values] of [['mode',profile.modes],['fan',Object.keys(profile.fan_map)]]){
      options[kind]={};
      for(const option of values){
        const manual=matching?saved.options?.[kind]?.[option]:null;
        options[kind][option]={status:['verified_supported','verified_unsupported'].includes(manual?.status)?manual.status:'library_unverified',
          source:typeof manual?.status==='string'&&manual.status.startsWith('verified_')?'physical_test':profile.source};
      }
    }
    profile.modes=profile.modes.filter(name=>options.mode[name]?.status!=='verified_unsupported');
    for(const name of Object.keys(profile.fan_map))if(options.fan[name]?.status==='verified_unsupported')delete profile.fan_map[name];
    if(matching&&saved.temperature?.status==='verified_supported'&&profile.temperature){
      const t=saved.temperature,b=profile.temperature;
      if([t.min,t.max,t.step].every(Number.isFinite)&&t.min>=b.min&&t.max<=b.max&&t.min<=t.max&&t.step>=b.step&&
        Math.abs(t.step/b.step-Math.round(t.step/b.step))<1e-6&&Math.abs((t.min-b.min)/b.step-Math.round((t.min-b.min)/b.step))<1e-6){
        profile.temperature={...b,min:t.min,max:t.max,step:t.step};
        statuses.temperature={...statuses.temperature,status:'verified_supported',source:'physical_test',confidence:'user_confirmed',verified_at:t.verified_at};
      }
    }
    profile.remote_model=remoteModel;
    profile.model_name=profile.models?.[remoteModel] || null;
    profile.model_source=matching&&saved.model_verified===true?'physical_test':remoteModel!==null?'decoder_or_configuration':'unknown';
    profile.ac_model=matching?saved.ac_model || null:null;
    profile.verification_stale=!!saved.protocol&&!matching;
    profile.feature_status=statuses;profile.option_status=options;profile.registry_version=registry.registry_version;
    profile.can_transmit=!!definition&&(!profile.requires_model || !!profile.models?.[remoteModel]);
    return profile;
  }
  function range(value, mode) {
    const profile=value?.feature_status?value:resolve(value), base=profile.temperature;
    if(!base)return null;
    const rule=profile.mode_rules?.[mode] || {};
    return {...base,min:rule.fixed_temp ?? Math.max(base.min,rule.min ?? base.min),max:rule.fixed_temp ?? Math.min(base.max,rule.max ?? base.max),
      controllable:profile.features.temperature===true&&rule.temperature_control!==false&&(!mode||base.modes.includes(mode)),
      fixed_fan:rule.fixed_fan || null};
  }
  function capabilities(value, mode) {
    const p=resolve(value),currentMode=mode || value?.state?.mode, t=range(p,currentMode);
    return {...p,...p.features,protocol_name:p.protocol,min_temp:t?.min ?? null,max_temp:t?.max ?? null,
      temperature_min:t?.min ?? null,temperature_max:t?.max ?? null,temperature_step:t?.step ?? null,temperature_unit:t?.unit || null,
      temperature_controllable:t?.controllable===true,temperature_modes:p.temperature?.modes || [],
      fans:t?.fixed_fan?Object.keys(p.fan_map).filter(f=>f===t.fixed_fan):Object.keys(p.fan_map),fan_speeds:t?.fixed_fan?Object.keys(p.fan_map).filter(f=>f===t.fixed_fan):Object.keys(p.fan_map),swing:p.features.swing_vertical,
      source:p.source,confidence:p.confidence};
  }
  function validateTemperature(value, requested, mode, retainedSetting=false) {
    const p=resolve(value),t=range(p,mode || value?.state?.mode);
    if(!p.can_transmit||!t||(!retainedSetting&&p.features.temperature!==true))return {valid:false,message:'Choose a supported exact protocol/model before changing temperature.'};
    if(typeof requested!=='number'||!Number.isFinite(requested)||requested<t.min||requested>t.max||
      Math.abs((requested-t.min)/t.step-Math.round((requested-t.min)/t.step))>1e-6)
      return {valid:false,message:'Temperature must be '+t.min+'–'+t.max+'°'+t.unit+' in '+t.step+'° steps.'};
    return {valid:true,value:requested};
  }
  function validateState(value,state) {
    const p=resolve(value),errors=[];
    if(!p.can_transmit)return {valid:false,errors:['Choose a supported exact protocol/model.']};
    if(!['on','off',true,false].includes(state?.power))errors.push('Invalid power.');
    if(!p.modes.includes(state?.mode))errors.push('Unsupported operating mode.');
    if(!Object.hasOwn(p.fan_map,state?.fan || ''))errors.push('Unsupported fan speed.');
    const t=validateTemperature(value,state?.temp ?? state?.temperature,state?.mode,true);if(!t.valid)errors.push(t.message);
    const rule=p.mode_rules[state?.mode] || {};
    if(rule.fixed_fan&&state.fan!==rule.fixed_fan)errors.push(state.mode+' requires '+rule.fixed_fan+' fan.');
    for(const [key,feature] of Object.entries({swing:'swing_vertical',swing_vertical:'swing_vertical',swing_horizontal:'swing_horizontal',turbo:'turbo',quiet:'quiet',eco:'eco',sleep:'sleep',display:'display',filter:'filter',clean:'clean',beep:'beep',i_feel:'i_feel'})){
      if(state[key]===undefined||state[key]===null)continue;
      if(!['on','off',true,false].includes(state[key]))errors.push('Invalid '+key+'.');
      else if(!p.features[feature]&&[true,'on'].includes(state[key]))errors.push(feature+' is unavailable for this protocol/model.');
    }return {valid:!errors.length,errors};
  }
  return {data:registry,protocol,model,resolve,range,capabilities,validateTemperature,validateState};
})();

export default AcCapabilityRegistry;
