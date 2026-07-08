from __future__ import annotations

import pytest

from src.data_loader import MissingDataError, load_raw_tables


def test_missing_files_message_lists_required_files(tmp_path):
    with pytest.raises(MissingDataError) as exc:
        load_raw_tables(tmp_path)
    message = str(exc.value)
    assert "olist_orders_dataset.csv" in message
    assert "product_category_name_translation.csv" in message

