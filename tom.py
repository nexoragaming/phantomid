import os
from dotenv import load_dotenv
import discord
from discord.ext import commands

load_dotenv()

token = os.getenv("DISCORD_BOT_TOKEN", "")
if not token:
    raise RuntimeError("DISCORD_BOT_TOKEN manquant dans le .env")

PHANTOM_ROLE_ID = int(os.getenv("DISCORD_PHANTOM_ROLE_ID", "0"))
if PHANTOM_ROLE_ID == 0:
    raise RuntimeError("DISCORD_PHANTOM_ROLE_ID manquant dans le .env")

intents = discord.Intents.default()
intents.guilds = True
intents.members = True  # requis pour détecter les changements de rôles

bot = commands.Bot(command_prefix="!", intents=intents)

# Cache simple pour éviter les doubles DM
dm_sent_cache: set[int] = set()

def build_phantom_dm(member: discord.Member) -> str:
    return (
        f"👋 Hello **{member.display_name}**!\n\n"
        "Thank you for connecting your account with **PhantomID** ✅\n\n"
        "To make sure you don’t miss anything, please **stay on this Discord server**.\n"
        "This is where all **important information and updates related to PhantomID** "
        "will be shared, including **upcoming tournaments, events, and announcements**.\n\n"
        "Welcome to the **PhantomID ecosystem 🧩🎮**"
    )

@bot.event
async def on_ready():
    print(f"✅ Tom est en ligne en tant que {bot.user} (ID: {bot.user.id})")

@bot.event
async def on_member_update(before: discord.Member, after: discord.Member):
    before_roles = {role.id for role in before.roles}
    after_roles = {role.id for role in after.roles}

    phantom_added = (
        PHANTOM_ROLE_ID not in before_roles
        and PHANTOM_ROLE_ID in after_roles
    )

    if not phantom_added:
        return

    if after.id in dm_sent_cache:
        return

    try:
        await after.send(build_phantom_dm(after))
        dm_sent_cache.add(after.id)
        print(f"📩 PhantomID DM sent to {after} ({after.id})")
    except discord.Forbidden:
        print(f"⚠️ Cannot DM {after} (DMs closed)")
    except Exception as e:
        print(f"❌ Error while DMing {after}: {e}")

bot.run(token)

