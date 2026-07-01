"""
One-off: create private Supabase Storage bucket `import-files` (Phase 0 of Import Excel upgrade)
"""
import os, sys, json
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Install requests first: pip install requests")

from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / "server" / ".env"
load_dotenv(env_path)

supabase_url = os.getenv("SUPABASE_URL")
service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
if not supabase_url or not service_role_key:
    sys.exit("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in server/.env")

headers = {
    "apikey": service_role_key,
    "Authorization": f"Bearer {service_role_key}",
    "Content-Type": "application/json",
}

BUCKET_ID = "import-files"

print(f"Checking if bucket '{BUCKET_ID}' already exists ...")
get_res = requests.get(f"{supabase_url}/storage/v1/bucket/{BUCKET_ID}", headers=headers)

if get_res.status_code == 200:
    print(f"Bucket '{BUCKET_ID}' already exists - skipping creation")
else:
    print(f"Bucket not found (status {get_res.status_code}) - creating ...")
    create_res = requests.post(
        f"{supabase_url}/storage/v1/bucket",
        headers=headers,
        data=json.dumps({"id": BUCKET_ID, "name": BUCKET_ID, "public": False}),
    )
    if create_res.status_code not in (200, 201):
        sys.exit(f"Failed to create bucket: {create_res.status_code} {create_res.text}")
    print("OK: bucket created")

# Verify
print("\nVerifying bucket ...")
verify_res = requests.get(f"{supabase_url}/storage/v1/bucket/{BUCKET_ID}", headers=headers)
if verify_res.status_code != 200:
    sys.exit(f"Verify failed: {verify_res.status_code} {verify_res.text}")

info = verify_res.json()
print(json.dumps(info, indent=2))
print(f"\nVerify: public = {info.get('public')}")
if info.get("public") is False:
    print("OK: bucket is private as expected")
else:
    print("WARNING: bucket is NOT private!")

print("\nDone OK")
