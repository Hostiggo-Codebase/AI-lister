"""Give the config sane dummy values so imports never look for a real .env."""

import os

os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("IMPORT_TIER2_ENABLED", "false")
