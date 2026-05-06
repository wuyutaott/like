# Like · 我的网络收藏夹

一个小而美的个人收藏夹，用来代替 Chrome 自带的书签管理。

- 两级分类，分类下可挂任意书签
- 书签：标题 / URL / 说明
- 增删改 + 跨分类移动 + 全文搜索
- **Google 登录 + 单所有者写权限**：任何人可读，只有配置的 `OWNER_EMAIL` 登录后才能改
- 后端 ~250 行 FastAPI，前端原生 HTML/CSS/JS，数据库 SQLite

## 启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # 然后填入下面的 5 个变量
uvicorn main:app --reload
```

打开 http://127.0.0.1:8000 ，右下角点 "用 Google 登录"。

## 必需的环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth Client Secret |
| `OAUTH_REDIRECT_URI` | 回调 URL，本地用 `http://127.0.0.1:8000/auth/google/callback`，部署后换成你的域名 |
| `OWNER_EMAIL` | 唯一允许写操作的 Gmail（其他人登录只读） |
| `SESSION_SECRET` | 用 `python -c "import secrets;print(secrets.token_urlsafe(48))"` 生成 |

### Google Cloud 一次性配置

1. https://console.cloud.google.com → 建项目
2. 左侧 *Google Auth Platform* → *Get started*：填 App name、support email、contact email、勾选 "I agree"
3. *Audience* → Add users → 填 `OWNER_EMAIL`（External 应用未审核前只有 test users 能登录）
4. *Clients* → Create OAuth client → Web application → Authorized redirect URIs 填上面的 `OAUTH_REDIRECT_URI`
5. 拿到 Client ID 和 Client Secret

## 部署到公网

回调 URL 必须用 HTTPS（Google 强制）。三件事：

1. `OAUTH_REDIRECT_URI=https://<你的域名>/auth/google/callback`
2. Google Cloud → Clients → 编辑你的 OAuth client → 把上面那条加到 *Authorized redirect URIs*
3. `main.py` 里 `SessionMiddleware` 的 `https_only=True`（在 HTTPS 环境）

## API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/categories` | 公开 | 列出全部分类（扁平） |
| POST | `/api/categories` | owner | `{name, parent_id?}` |
| PATCH | `/api/categories/{id}` | owner | 改名 / 改父分类 |
| DELETE | `/api/categories/{id}` | owner | 级联删除子分类与书签 |
| GET | `/api/bookmarks?category_id=&q=` | 公开 | 列书签；带 `category_id` 时同时返回其子分类下书签 |
| POST | `/api/bookmarks` | owner | `{category_id, title, url, description?}` |
| PATCH | `/api/bookmarks/{id}` | owner | 改任意字段（含 `category_id` = 移动） |
| DELETE | `/api/bookmarks/{id}` | owner | 删除 |
| GET | `/auth/me` | 公开 | `{user, is_owner}` |
| GET | `/auth/google/login` | — | 跳转 Google |
| GET | `/auth/google/callback` | — | OAuth 回调 |
| POST | `/auth/logout` | — | 清除 session |

## 文件

```
like/
├── main.py            FastAPI 路由 + 鉴权依赖
├── auth.py            Google OAuth + Session
├── db.py              SQLite 连接 + 建表
├── requirements.txt
├── .env               凭据（不提交）
├── .env.example
├── static/
│   ├── index.html     单页布局
│   ├── app.js         状态 + 渲染 + 登录态
│   └── style.css
└── bookmarks.db       运行时生成
```
