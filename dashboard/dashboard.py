import streamlit as st
from pathlib import Path
import subprocess
import json
from datetime import datetime

st.set_page_config(
    page_title="Money-Machine",
    page_icon="M",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.title("Maurice's Multi-Device Money-Machine")
st.caption("AI Agents - Ollama GLM4 - OpenClaw CLI")

with st.sidebar:
    st.header("Settings")

    st.subheader("Server Info")
    st.metric("Host", "65.21.203.174")
    st.metric("AI Model", "glm4:9b-chat")

    st.divider()

    st.subheader("System Health")

    ollama_ok = subprocess.run(
        ["curl", "-s", "-m", "3", "http://localhost:11434/api/tags"],
        capture_output=True
    ).returncode == 0

    st.write(f"Ollama: {'Running' if ollama_ok else 'Down'}")

    st.divider()

    st.subheader("Agents")
    agents = [
        ("Monica", "CEO", "glm4:9b-chat"),
        ("Dwight", "Research", "glm4:9b-chat"),
        ("Kelly", "Content", "glm4:9b-chat"),
        ("Ryan", "Code", "glm4:9b-chat"),
        ("Chandler", "Sales", "glm4:9b-chat"),
        ("Ross", "YouTube", "glm4:9b-chat"),
    ]

    for name, role, model in agents:
        with st.expander(f"{name} - {role}"):
            st.write(f"**Model:** {model}")

    st.divider()

    if st.button("Health Check"):
        result = subprocess.run(
            ["bash", "server/scripts/health-check.sh"],
            capture_output=True, text=True, cwd="/opt/money-machine"
        )
        st.code(result.stdout)

    if st.button("Models"):
        result = subprocess.run(
            ["ollama", "list"], capture_output=True, text=True
        )
        st.code(result.stdout)

tab1, tab2, tab3, tab4 = st.tabs([
    "Dashboard", "Agents", "Revenue", "Logs"
])

with tab1:
    st.header("Live Dashboard")

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Active Agents", "6")
    with col2:
        st.metric("AI Model", "GLM4")
    with col3:
        st.metric("Provider", "Ollama")
    with col4:
        st.metric("Status", "Online" if ollama_ok else "Offline")

    st.divider()

    col1, col2 = st.columns(2)
    with col1:
        st.subheader("Server Resources")
        ram_result = subprocess.run(["free", "-h"], capture_output=True, text=True)
        st.text(ram_result.stdout)

    with col2:
        st.subheader("Model Status")
        model_result = subprocess.run(["ollama", "list"], capture_output=True, text=True)
        st.text(model_result.stdout)

with tab2:
    st.header("Agent Status")

    for name, role, model in agents:
        col1, col2, col3 = st.columns([2, 2, 1])
        with col1:
            st.write(f"**{name}** - {role}")
        with col2:
            st.write(f"Model: {model}")
        with col3:
            st.write("Active")
        st.divider()

with tab3:
    st.header("Revenue Tracking")

    revenue_file = Path("/opt/money-machine/openclaw/memory/revenue.json")
    if revenue_file.exists():
        st.json(json.loads(revenue_file.read_text()))
    else:
        st.info("No revenue data yet")

    st.divider()

    st.subheader("Add Revenue")
    col1, col2, col3 = st.columns(3)
    with col1:
        amount = st.number_input("Betrag (EUR)", min_value=0.0, value=10.0)
    with col2:
        source = st.selectbox("Quelle", ["X Post", "Template Sale", "Freelance", "Affiliate"])
    with col3:
        if st.button("Speichern"):
            st.success(f"Revenue von EUR {amount:.2f} gespeichert!")

with tab4:
    st.header("System Logs")

    log_source = st.selectbox(
        "Log Source:",
        ["Ollama", "Telegram Bot", "Dashboard"]
    )

    if log_source == "Ollama":
        st.code(subprocess.run(
            ["journalctl", "-u", "ollama", "-n", "50", "--no-pager"],
            capture_output=True, text=True
        ).stdout)
    elif log_source == "Telegram Bot":
        log_file = Path("/tmp/telegram-bot.log")
        if log_file.exists():
            st.code(log_file.read_text()[-3000:])
        else:
            st.info("No telegram bot logs yet")
    else:
        log_file = Path("/tmp/dashboard.log")
        if log_file.exists():
            st.code(log_file.read_text()[-3000:])
        else:
            st.info("No dashboard logs yet")
