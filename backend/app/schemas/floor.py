"""The editable layout contains no live production state."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Placement(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: uuid.UUID
    x: int = Field(ge=0, le=10000, strict=True)
    y: int = Field(ge=0, le=10000, strict=True)
    rotation: Literal[0, 90, 180, 270] = 0


class LayoutMachine(Placement):
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=120)
    machine_type: str = Field(min_length=1, max_length=40)


class Decor(Placement):
    kind: str
    name: str = Field(min_length=1, max_length=120)
    width: int = Field(ge=1, le=10000, strict=True)
    height: int = Field(ge=1, le=10000, strict=True)


class LayoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0, strict=True)
    origin_x: int = Field(strict=True)
    origin_y: int = Field(strict=True)
    columns: int = Field(ge=1, le=10000, strict=True)
    rows: int = Field(ge=1, le=10000, strict=True)
    machines: list[LayoutMachine] = Field(max_length=2000)
    decor: list[Decor] = Field(max_length=2000)


class CatalogItem(BaseModel):
    kind: str
    label: str
    category: Literal["Machines", "Structure", "Furniture", "Markings"]
    width: int
    height: int
    solid: bool = True
    resizable: bool = False


class LayoutOut(LayoutIn):
    catalog: list[CatalogItem]
