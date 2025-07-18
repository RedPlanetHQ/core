
<div align="right">
  <details>
    <summary >🌐 Language</summary>
    <div>
      <div align="center">
        <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=en">English</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=zh-CN">简体中文</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=zh-TW">繁體中文</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ja">日本語</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ko">한국어</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=hi">हिन्दी</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=th">ไทย</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=fr">Français</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=de">Deutsch</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=es">Español</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=it">Italiano</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ru">Русский</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=pt">Português</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=nl">Nederlands</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=pl">Polski</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=ar">العربية</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=fa">فارسی</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=tr">Türkçe</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=vi">Tiếng Việt</a>
        | <a href="https://openaitx.github.io/view.html?user=RedPlanetHQ&project=core&lang=id">Bahasa Indonesia</a>
      </div>
    </div>
  </details>
</div>

<div align="center">
  <a href="https://core.heysol.ai">
    <img src="https://github.com/user-attachments/assets/89066cdd-204b-46c2-8ad4-4935f5ca9edd" width="200px" alt="CORE logo" />
  </a>

### C.O.R.E: Your digital brain for the AI era

<p align="center">
    <a href="https://docs.heysol.ai/core/overview"><b>Documentation</b></a> •
    <a href="https://discord.gg/YGUZcvDjUa"><b>Discord</b></a>
</p>
</div>

## 🧠 C.O.R.E.

**Contextual Observation & Recall Engine**

C.O.R.E is a portable memory graph built from your llm interactions and personal data, making all your context and workflow history accessible to any AI tool, just like a digital brain. This eliminates the need for repeated context sharing . The aim is to provide:

- **Unified, Portable Memory**: Add and recall context seamlessly, and connect your memory across apps like Claude, Cursor, Windsurf and more.
- **Relational, Not just Flat Facts**: CORE organizes your knowledge, storing both facts and relationships for a deeper richer memory like a real brain.
- **User Owned**: You decide what to keep, update or delete and share your memory across the tool you want and be freed from vendor lock-in.

## 🎥 Demo Video

[Check C.O.R.E Demo](https://youtu.be/iANZ32dnK60)

<img width="954" height="700" alt="Core dashboard" src="https://github.com/user-attachments/assets/d684b708-6907-47be-9499-a30b25434694" />

## 🧩  Key Features

- **Memory Graph**: Visualise how your facts and preferences link together
- **Chat with Memory**: Ask questions about memory for instant insights and understanding
- **Plug n Play**: Instantly use CORE memory in apps like Cursor, Claude

## ☁️ C.O.R.E Cloud Setup

1. Sign up to [Core Cloud](https://core.heysol.ai) and start building your memory graph.
2. Add your text that you want to save in memory. Once clicking on `+ Add` button your memory graph will be generated.
3. [Connect Core Memory MCP with Cursor](#connecting-core-mcp-with-cursor)

## 💻 C.O.R.E Local Setup

#### Prerequisites

1. Docker
2. OpenAI API Key


> **Note:** We are actively working on improving support for Llama models. At the moment, C.O.R.E does not provide optimal results with Llama-based models, but we are making progress to ensure better compatibility and output in the near future.
> 
#### Run C.O.R.E locally

1. **Copy Environment Variables**

   Copy the example environment file to `.env`:

   ```bash
   cp .env.example .env
   ```

2. **Start the Application**

   Use Docker Compose to start all required services:

   ```bash
   docker-compose up
   ```

3. **Access the App**

   Once the containers are running, open your browser and go to [http://localhost:3000](http://localhost:3000).

4. **Create Account with Magic Link**

   - To Create an account, click on `Continue with email` button

     <img width="865" height="490" alt="Create account" src="https://github.com/user-attachments/assets/65de110b-2b1f-42a5-9b8a-954227d68d52" />

   - Enter your email and click on `Send a Magic Link` button

     <img width="824" height="429" alt="Enter email" src="https://github.com/user-attachments/assets/76128b61-2086-48df-8332-38c2efa14087" />

   - `Copy the magic link from terminal logs` and open it in your browser

     <img width="1010" height="597" alt="Magic link" src="https://github.com/user-attachments/assets/777cb4b1-bb93-4d54-b6ab-f7147e65aa5c" />


5. **Create Your Private Space & Add Data**

   - In the dashboard, go to the top right section -> Type a message, e.g., `I love playing badminton`, and click `+Add`.
   - Your memory is queued for processing; you can monitor its status in the `Logs` section.
     
     <img width="1496" height="691" alt="Core memory logs" src="https://github.com/user-attachments/assets/dc34a7af-fe52-4142-9ecb-49ddc4e0e854" />

   - Once processing is complete, nodes will be added to your private knowledge graph and visible in the dashboard.
   - You can later choose to connect this memory to other tools or keep it private.

6. **Search Your Memory**

   - Use the dashboard's search feature to query your ingested data within your private space.


## Connecting CORE MCP with Cursor

1. Open the CORE dashboard and navigate to the API section to generate a new API token.
2. In Cursor, go to: Settings → Tools & Integrations → New MCP Server.
3. Add the CORE MCP server using the configuration format below. Be sure to replace the API_TOKEN value with the token you generated in step 1.

   MCP configuration to add in Cursor

   ```json
   {
     "mcpServers": {
       "memory": {
         "command": "npx",
         "args": ["-y", "@redplanethq/core-mcp"],
         "env": {
           "API_TOKEN": "YOUR_API_TOKEN_HERE",
           "API_BASE_URL": "https://core.heysol.ai",
           "SOURCE": "cursor"
         }
       }
     }
   }
   ```

4. Go to Settings-> User rules -> New Rule -> and add the below rule to ensure all your chat interactions are being stored in CORE memory

```
After every interaction, update the memory with the user's query and the assistant's
response to core-memory mcp. sessionId should be the uuid of the conversation
```

## Documentation

Explore our documentation to get the most out of CORE
- [Basic Concepts](https://docs.heysol.ai/core/overview)
- [API Reference](https://docs.heysol.ai/core/local-setup)
- [Connect Core Memory MCP with Cursor](#connecting-core-mcp-with-cursor)


## 🧑‍💻 Support
Have questions or feedback? We're here to help:
- Discord: [Join core-support channel](https://discord.gg/YGUZcvDjUa)
- Documentation: [docs.heysol.ai/core](https://docs.heysol.ai/core/overview)
- Email: manik@poozle.dev

## Usage Guidelines

**Store:**

- Conversation history
- User preferences
- Task context
- Reference materials

**Don't Store:**

- Sensitive data (PII)
- Credentials
- System logs
- Temporary data

## 👥 Contributors

<a href="https://github.com/RedPlanetHQ/core/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=RedPlanetHQ/core" />
</a>
