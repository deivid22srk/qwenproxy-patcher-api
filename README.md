# QwenProxy Patcher API 🍪 ⚡

Uma API leve e rápida desenvolvida em **TypeScript** e **Hono** para clonar o repositório original do [QwenProxy](https://github.com/pedrofariasx/qwenproxy), aplicar dinamicamente o patch de autenticação por Cookies (removendo a dependência pesada do Playwright e corrigindo shebangs para Termux/Android) e disponibilizar o código pronto e empacotado em um arquivo `.zip` para download.

---

## 🌟 Recursos

* **Clonagem Dinâmica**: Clona automaticamente a última versão do repositório original diretamente do GitHub.
* **Automação de Patch**: Aplica os scripts que removem o Playwright e adicionam o suporte a Cookies no lugar.
* **Compatibilidade com Termux/Android**: Corrige as chamadas de scripts no `package.json` para rodarem diretamente com o Node bypassando erros de shebang (`/usr/bin/env: bad interpreter`).
* **Download em Zip**: Entrega todo o código pronto e estruturado em um único arquivo `.zip` na resposta da API.
* **Limpeza Automática**: Apaga arquivos temporários gerados após o download para economizar espaço em disco.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
* **Node.js** (v18 ou superior recomendado)
* **Git** instalado (necessário para clonar o repositório original dinamicamente)

### Instalação

1. Clone este repositório da API:
   ```bash
   git clone https://github.com/deivid22srk/qwenproxy-patcher-api.git
   cd qwenproxy-patcher-api
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Inicie o servidor da API:
   ```bash
   npm start
   ```

O servidor iniciará na porta `3000` (ou na definida na variável de ambiente `PORT`). Acesse no navegador: `http://localhost:3000`.

---

## 🔌 Endpoints da API

### `GET /`
Retorna uma interface web simples e bonita contendo informações sobre a API e um botão para iniciar o download do proxy modificado.

### `GET /patch`
Endpoint principal. Executa todo o processo de clonagem, aplicação do patch, criação do arquivo `.zip` e inicia o download diretamente no seu navegador ou cliente HTTP.

**Exemplo com curl:**
```bash
curl -L -O -J http://localhost:3000/patch
```
*(O comando acima irá baixar e salvar o arquivo como `qwenproxy-cookies.zip` no diretório atual).*

---

## 🍪 Como Importar os Cookies no Proxy Baixado

Após fazer o download do `.zip` e extrair o projeto em sua máquina/Termux, siga os passos abaixo para configurar os cookies de sessão do Qwen:

### Passo 1: Obter seus Cookies
1. Acesse [https://chat.qwen.ai](https://chat.qwen.ai) no seu navegador e faça o login.
2. Abra as Ferramentas do Desenvolvedor (`F12` ou `Ctrl+Shift+I`).
3. Vá em **Application** (ou **Armazenamento**) &rarr; **Cookies** &rarr; `https://chat.qwen.ai`.
4. Copie a string completa dos cookies em formato de texto.

### Passo 2: Configurar no Proxy
Você pode importar os cookies de três formas diferentes:

#### Método A: Importar via URL (Recomendado)
Você pode salvar seus cookies em uma URL privada (como Pastebin raw ou similar) e importá-los diretamente:
```bash
# Executando o script bash diretamente
bash import-cookies.sh https://sua-url.com/raw-cookies

# Ou usando o script npm
npm run import-cookies -- https://sua-url.com/raw-cookies
```

#### Método B: Arquivo `cookies.json`
Crie um arquivo chamado `cookies.json` na raiz do projeto extraído com a seguinte estrutura:
```json
{
  "cookies": "cole_seus_cookies_aqui",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36..."
}
```

#### Método C: Variável de Ambiente `.env`
Renomeie o `.env.example` para `.env` e cole seus cookies na variável correspondente:
```env
QWEN_COOKIES="sua_string_de_cookies_aqui"
```

---

## 📁 Estrutura do Projeto

* `src/index.ts`: Ponto de entrada do servidor Hono que gerencia as rotas e o ciclo de vida do patch.
* `patcher/`: Contém os scripts e arquivos de substituição injetados no projeto original:
  * `apply-patch.sh`: Script principal em bash que realiza as substituições e remoção do Playwright.
  * `playwright-cookies.ts`: O substituto leve baseado em HTTP/Cookies que simula a interface do Playwright.
  * `patch-server.js` / `patch-chat.js`: Scripts Node para reescrever as dependências nas rotas e servidores.
  * `package.json` (interno): Configuração de escopo para forçar o carregamento de scripts locais como CommonJS.

---

## 📝 Licença

Mesma licença do projeto original: [ISC License](LICENSE)
