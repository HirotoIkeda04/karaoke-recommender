from fetch_certifications import extract_cert


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
