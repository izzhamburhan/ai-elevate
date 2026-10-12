"""Malaysia's federal public holidays for 2026 (real calendar, the part the data window needs).

Source: the 2026 lists published under the Holidays Act 1951, as summarised by public calendars (checked 2026-10-12).
Islamic and lunar dates are announced by the authorities and are marked `tentative`; state-only holidays are left out.
"""

from __future__ import annotations

from datetime import date

HOLIDAYS_2026: list[tuple[date, str, bool]] = [  # (day, name, tentative)
    (date(2026, 1, 1), "New Year's Day", False),
    (date(2026, 2, 17), "Chinese New Year", True),
    (date(2026, 2, 18), "Chinese New Year (second day)", True),
    (date(2026, 3, 21), "Hari Raya Aidilfitri", True),
    (date(2026, 3, 23), "Hari Raya Aidilfitri (replacement)", True),
    (date(2026, 5, 1), "Labour Day", False),
    (date(2026, 5, 27), "Hari Raya Aidiladha", True),
    (date(2026, 5, 31), "Wesak Day", True),
    (date(2026, 6, 1), "Agong's Birthday", False),
    (date(2026, 6, 2), "Wesak Day (replacement)", True),
    (date(2026, 6, 17), "Awal Muharram", True),
    (date(2026, 8, 25), "Maulidur Rasul", True),
    (date(2026, 8, 31), "National Day", False),
    (date(2026, 9, 16), "Malaysia Day", False),
    (date(2026, 12, 25), "Christmas Day", False),
]
HOLIDAY_DAYS = {d for d, _, _ in HOLIDAYS_2026}


def is_holiday(day: date) -> bool:
    return day in HOLIDAY_DAYS