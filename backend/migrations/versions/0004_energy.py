"""Energy management: machine power use and electricity cost per plan option."""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("machines", sa.Column("running_kw", sa.Numeric(8, 2), nullable=True))
    op.add_column("machines", sa.Column("idle_kw", sa.Numeric(8, 2), nullable=True))
    op.add_column("plan_options", sa.Column("energy_kwh", sa.Numeric(12, 2), nullable=True))
    op.add_column("plan_options", sa.Column("energy_cost", sa.Numeric(14, 2), nullable=True))


def downgrade():
    op.drop_column("plan_options", "energy_cost")
    op.drop_column("plan_options", "energy_kwh")
    op.drop_column("machines", "idle_kw")
    op.drop_column("machines", "running_kw")
