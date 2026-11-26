from typing import Literal

from pydantic import BaseModel, Field, model_validator

NairaDenomination = Literal[5, 10, 20, 50, 100, 200, 500, 1000]
ConfirmationStatus = Literal["pending", "confirmed", "corrected", "rejected"]


class Prediction(BaseModel):
    denomination_ngn: int
    confidence: float = Field(ge=0, le=1)


class ImageQuality(BaseModel):
    accepted: bool
    warnings: list[str]


class Decision(BaseModel):
    requires_user_confirmation: bool = True
    confidence_band: str


class ModelInfo(BaseModel):
    name: str
    version: str


class CashInferenceResponse(BaseModel):
    inference_id: str
    prediction: Prediction
    image_quality: ImageQuality
    decision: Decision
    model: ModelInfo


class CashSessionCreate(BaseModel):
    currency: Literal["NGN"] = "NGN"


class CashEntryCreate(BaseModel):
    predicted_denomination: NairaDenomination | None = None
    confirmed_denomination: NairaDenomination | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    confirmation_status: ConfirmationStatus

    @model_validator(mode="after")
    def validate_confirmed_denomination(self) -> "CashEntryCreate":
        if self.confirmation_status in ("confirmed", "corrected") and self.confirmed_denomination is None:
            raise ValueError("confirmed_denomination is required when status is confirmed or corrected")
        return self


class CashEntryResponse(BaseModel):
    id: str
    session_id: str
    predicted_denomination: int | None
    confirmed_denomination: int | None
    confidence: float | None
    confirmation_status: ConfirmationStatus
    created_at: str


class CashSessionResponse(BaseModel):
    id: str
    currency: str
    created_at: str
    ended_at: str | None
    confirmed_total_ngn: int
    confirmed_count: int
    entries: list[CashEntryResponse]
