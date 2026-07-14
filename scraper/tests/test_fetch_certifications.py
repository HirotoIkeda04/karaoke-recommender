from fetch_certifications import extract_cert, parse_riaj_streaming_cert


def test_extract_cert_supports_physical_single_certification() -> None:
    wikitext = """
    {{Infobox Single
    | Name = A・RA・SHI
    | Certification = * ダブル・プラチナ（日本レコード協会）
    }}
    """

    assert extract_cert(wikitext) == (3, "ダブル・プラチナ")


def test_extract_cert_uses_strongest_riaj_level() -> None:
    wikitext = """
    == 認定 ==
    {| class=wikitable
    ! 認定 (RIAJ)
    | ゴールド
    | トリプル・プラチナ
    |}
    """

    assert extract_cert(wikitext) == (4, "トリプル・プラチナ")


def test_parse_riaj_streaming_cert_uses_exact_song_and_strongest_level() -> None:
    payload = {
        "success": True,
        "results": [
            {
                "StCert": {"name": "プラチナ"},
                "StProduct": {
                    "name": "Subtitle",
                    "artist": "Official髭男dism",
                },
            },
            {
                "StCert": {"name": "ダイヤモンド"},
                "StProduct": {
                    "name": "Ｓｕｂｔｉｔｌｅ",
                    "artist": "Official 髭男dism",
                },
            },
            {
                "StCert": {"name": "ダブル・ダイヤモンド"},
                "StProduct": {
                    "name": "Subtitle (cover)",
                    "artist": "Other Artist",
                },
            },
        ],
    }

    assert parse_riaj_streaming_cert(payload, "Subtitle", "Official髭男dism") == (5, "ダイヤモンド")


def test_parse_riaj_streaming_cert_returns_zero_for_non_matching_cover() -> None:
    payload = {
        "success": True,
        "results": [
            {
                "StCert": {"name": "ダイヤモンド"},
                "StProduct": {"name": "Subtitle", "artist": "Cover Band"},
            }
        ],
    }

    assert parse_riaj_streaming_cert(payload, "Subtitle", "Official髭男dism") == (0, "")
