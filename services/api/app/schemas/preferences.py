from typing import Literal

from pydantic import BaseModel, Field

TextSize = Literal["standard", "large", "extra_large"]


class UserPreferences(BaseModel):
    text_size: TextSize = "large"
    high_contrast: bool = False
    speech_enabled: bool = True
    speech_rate: float = Field(default=1.0, ge=0.5, le=2.0)


class UserPreferencesResponse(UserPreferences):
    updated_at: str
