from typing import Any, Literal

from pydantic import BaseModel, Field

SourceType = Literal["notification", "receipt", "pasted_text", "other"]


class TransactionExtractRequest(BaseModel):
    raw_text: str = Field(min_length=1, max_length=10000)
    source_type: SourceType = "pasted_text"


class TransactionExtractResponse(BaseModel):
    amount_kobo: int | None = None
    currency: str = "NGN"
    transaction_date: str | None = None
    reference: str | None = None
    sender_label: str | None = None
    recipient_label: str | None = None
    reported_status: str | None = None
    source_type: SourceType
    extracted_fields: dict[str, Any] = Field(default_factory=dict)
    requires_user_confirmation: bool = True
    disclaimer: str = (
        "Extracted fields are unverified text parsing results and do not constitute "
        "independent bank settlement verification."
    )


class TransactionCreate(BaseModel):
    amount_kobo: int | None = Field(default=None, ge=0)
    currency: Literal["NGN"] = "NGN"
    transaction_date: str | None = None
    reference: str | None = Field(default=None, max_length=200)
    sender_label: str | None = Field(default=None, max_length=200)
    recipient_label: str | None = Field(default=None, max_length=200)
    reported_status: str | None = Field(default=None, max_length=120)
    source_type: SourceType = "pasted_text"
    extracted_fields: dict[str, Any] = Field(default_factory=dict)
    user_confirmed: bool = False


class TransactionUpdate(BaseModel):
    amount_kobo: int | None = Field(default=None, ge=0)
    transaction_date: str | None = None
    reference: str | None = Field(default=None, max_length=200)
    sender_label: str | None = Field(default=None, max_length=200)
    recipient_label: str | None = Field(default=None, max_length=200)
    reported_status: str | None = Field(default=None, max_length=120)
    user_confirmed: bool | None = None


class TransactionResponse(BaseModel):
    id: str
    amount_kobo: int | None
    currency: str
    transaction_date: str | None
    reference: str | None
    sender_label: str | None
    recipient_label: str | None
    reported_status: str | None
    source_type: SourceType
    extracted_fields: dict[str, Any]
    user_confirmed: bool
    created_at: str
    updated_at: str
