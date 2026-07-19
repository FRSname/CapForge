from backend.engine import system_fonts


class FakeFont:
    def __init__(self, family: str, style: str):
        self._name = (family, style)

    def getname(self):
        return self._name


def test_scan_font_paths_reads_collection_faces(monkeypatch):
    names = {
        ("regular.ttf", 0): ("Example Sans", "Regular"),
        ("family.ttc", 0): ("Collection Sans", "Regular"),
        ("family.ttc", 1): ("Collection Serif", "Bold"),
    }

    def fake_truetype(path, _size, index=0):
        try:
            family, style = names[(path, index)]
        except KeyError as exc:
            raise OSError("no more faces") from exc
        return FakeFont(family, style)

    monkeypatch.setattr(system_fonts.ImageFont, "truetype", fake_truetype)

    faces = system_fonts._scan_font_paths(["regular.ttf", "family.ttc"])

    assert [(face.family, face.index) for face in faces] == [
        ("Example Sans", 0),
        ("Collection Sans", 0),
        ("Collection Serif", 1),
    ]


def test_family_list_is_unique_and_sorted(monkeypatch):
    faces = (
        system_fonts.SystemFontFace("Zulu", "Regular", "/z.ttf"),
        system_fonts.SystemFontFace("alpha", "Regular", "/a.ttf"),
        system_fonts.SystemFontFace("Alpha", "Bold", "/ab.ttf"),
    )
    monkeypatch.setattr(system_fonts, "system_font_faces", lambda: faces)

    assert system_fonts.list_system_font_families() == ["alpha", "Zulu"]


def test_resolver_prefers_requested_weight_and_upright_face(monkeypatch):
    faces = (
        system_fonts.SystemFontFace("Example", "Regular", "/regular.ttf"),
        system_fonts.SystemFontFace("Example", "Bold Italic", "/bold-italic.ttf"),
        system_fonts.SystemFontFace("Example", "Bold", "/bold.ttf", index=2),
    )
    monkeypatch.setattr(system_fonts, "system_font_faces", lambda: faces)

    regular = system_fonts.find_system_font_face("example", bold=False)
    bold = system_fonts.find_system_font_face("Example", bold=True)

    assert regular is not None and regular.path == "/regular.ttf"
    assert bold is not None and bold.path == "/bold.ttf" and bold.index == 2


def test_resolver_returns_none_for_unknown_family(monkeypatch):
    monkeypatch.setattr(system_fonts, "system_font_faces", lambda: ())

    assert system_fonts.find_system_font_face("Missing") is None
