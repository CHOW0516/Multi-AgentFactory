"""Add visual floor layouts; preserve pre-grid coordinates for recovery."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("machines", sa.Column("original_floor_x", sa.Integer(), nullable=True))
    op.add_column("machines", sa.Column("original_floor_y", sa.Integer(), nullable=True))
    op.execute("UPDATE machines SET original_floor_x = floor_x, original_floor_y = floor_y")
    op.execute("UPDATE machines SET floor_x = FLOOR(floor_x / 10.0 + 0.5) * 10, "
               "floor_y = FLOOR(floor_y / 10.0 + 0.5) * 10")
    op.create_table(
        "floor_layout",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("singleton", sa.Integer(), nullable=False, unique=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("origin_x", sa.Integer(), nullable=False),
        sa.Column("origin_y", sa.Integer(), nullable=False),
        sa.Column("columns", sa.Integer(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("decor", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("singleton = 1", name=op.f("ck_floor_layout_singleton")),
    )
    op.create_table(
        "floor_placements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("machine_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("machines.id"), nullable=False, unique=True),
        sa.Column("x", sa.Integer(), nullable=False),
        sa.Column("y", sa.Integer(), nullable=False),
        sa.Column("rotation", sa.Integer(), nullable=False),
        sa.CheckConstraint("rotation IN (0, 90, 180, 270)", name=op.f("ck_floor_placements_rotation")),
    )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM floor_layout)")):
        raise RuntimeError("Export the saved floor layout before a destructive schema downgrade; application rollback needs no downgrade")
    op.execute("UPDATE machines SET floor_x = COALESCE(original_floor_x, floor_x), "
               "floor_y = COALESCE(original_floor_y, floor_y)")
    op.drop_table("floor_placements")
    op.drop_table("floor_layout")
    op.drop_column("machines", "original_floor_y")
    op.drop_column("machines", "original_floor_x")
