# 把 PrintShelf 发到 GitHub（零基础指引）

这份文档假设你**从来没用过 GitHub**。跟着做就行，不需要下载任何额外软件——你的电脑上 Git 已经装好了（版本 2.55），截图里那个 "Download GitHub Copilot app" 是 AI 编程助手，跟发布代码无关，不用点。

项目本地已经准备好了：

- ✅ Git 仓库已初始化，分支 `main`
- ✅ 首个提交已创建（`ed2e600`），共 237 个文件
- ✅ `.gitignore` 已排除 `data/`（你的真实模型库、打印机访问码）、`dist/`、`node_modules/`
- ✅ 源码里的真实 IP / 序列号 / 访问码已改成示例值
- ✅ `LICENSE`（MIT）和第三方许可声明已就位

---

## 第 0 步：先注册 GitHub 账号

1. 打开 https://github.com
2. 点右上角的 **Sign up**（注册），不是 Sign in
3. 用邮箱注册，设密码，验证邮箱
4. 起一个用户名，比如 `yourname-3d`（这会成为你主页地址的一部分：`github.com/yourname-3d`）

记住你的**用户名**，后面要用。

---

## 第 1 步：在 GitHub 上新建一个空仓库

1. 登录后，点右上角 **+** → **New repository**
2. 填写：
   - **Repository name**：`PrintShelf`（或你想要的名字）
   - **Description**：`本地 3MF 模型库 —— 扫描、分类、预览、去重、一键送切片软件`
   - **Public** / **Private**：选 Public 别人才看得到（选 Private 只有你自己能看到）
   - ⚠️ **不要**勾选 "Add a README file" / "Add .gitignore" / "Choose a license" —— 本地都已经有了，勾了会冲突
3. 点 **Create repository**

创建后会看到一个页面，上面有一堆命令，标题类似 "…or push an existing repository from the command line"。**先别照着抄**，用下面我给你的命令（因为你的分支叫 `main`）。

---

## 第 2 步：把本地代码推上去

### 2.1 改提交作者（重要）

现在提交记录里显示的是占位符 `PrintShelf`。注册完 GitHub 后，改成你自己的名字和邮箱：

```bash
cd /d/AI工具workbuddy/PrintShelf

git config user.name "你的GitHub用户名"
git config user.email "你的注册邮箱"

# 把首个提交也改成你的身份
git commit --amend --reset-author --no-edit
```

> 如果不想公开你的真实邮箱，GitHub 提供隐私邮箱：在 GitHub → Settings → Emails → 勾选 "Keep my email addresses private"，会给你一个类似 `12345678+yourname@users.noreply.github.com` 的地址，用它代替上面的注册邮箱。

### 2.2 关联远程仓库并推送

在 GitHub 新建仓库的页面上，复制仓库地址，形如：

```
https://github.com/你的用户名/PrintShelf.git
```

然后在终端（Git Bash / PowerShell 都行）执行：

```bash
cd /d/AI工具workbuddy/PrintShelf

# 关联远程仓库（把 URL 换成你自己的）
git remote add origin https://github.com/你的用户名/PrintShelf.git

# 推送到 GitHub
git push -u origin main
```

第一次推送会弹出登录窗口：

- Windows 通常会弹 **Git Credential Manager** 的浏览器登录页 → 点登录、授权即可
- 如果没弹，GitHub 早已不支持账号密码直接 push，需要用 **Personal Access Token（个人访问令牌）**：
  1. GitHub → 头像 → Settings → Developer settings → Personal access tokens → Tokens (classic)
  2. Generate new token (classic)，勾选 `repo` 权限，生成后**立刻复制**（只显示一次）
  3. 再执行 `git push`，用户名填 GitHub 用户名，密码粘贴那个 token

推送成功后刷新 GitHub 仓库页面，就能看到全部代码了。

---

## 第 3 步：让仓库看起来像样（可选但推荐）

### 加 topics（标签）
在仓库页面右侧 **About** 点齿轮图标，添加标签：
`electron`, `3mf`, `3d-printing`, `bambu-lab`, `snapmaker`, `desktop-app`, `offline`

### 上传 Release（让别人直接下载 exe）

GitHub 的 Release 可以放安装包，别人不用装 Node 也能用：

1. 仓库页面右侧 **Releases** → **Create a new release**
2. Tag version 填 `v1.0.0`，Title 填 `PrintShelf 1.0.0`
3. 把 `dist/PrintShelf-1.0.0-portable.zip`（约 113 MB）拖进附件区
4. 写几句说明，点 **Publish release**

> 单个附件 GitHub 免费额度是 100 MB 文件上限吗？不是——免费版单文件上限 **100 MB** 会有警告，但实测 113 MB 的 zip 通常也能传；如果传不了，可以把绿色版目录自己用 7-Zip 分卷压缩，或者只传源码让别人自己 `npm install` + `node tools/build-all.js --force` 构建。

---

## 以后改了代码怎么更新

每次改完代码，执行三条命令：

```bash
cd /d/AI工具workbuddy/PrintShelf

git add -A
git commit -m "简单描述这次改了什么"
git push
```

就这么简单。`git push` 不用再加 `-u origin main`，Git 已经记住了。

---

## 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `git status` | 看哪些文件改了、哪些还没提交 |
| `git add -A` | 把所有改动加入待提交 |
| `git commit -m "说明"` | 提交（存一个存档点） |
| `git push` | 上传到 GitHub |
| `git pull` | 从 GitHub 拉最新代码（换电脑时用） |
| `git log --oneline` | 看提交历史 |

---

## 常见坑

1. **push 时报 `remote: Repository not found`** → 仓库地址写错了，或仓库是 Private 但你没登录。用 `git remote -v` 检查地址。
2. **push 一直要密码** → GitHub 不支持密码了，要用 token（见 2.2）。
3. **不小心把 `data/` 传上去了** → 立刻去 GitHub 仓库删除文件，并且**改掉你的打印机访问码**（`data/settings.json` 里的）。已经 push 的敏感信息即使删除也会留在历史里，最稳妥是改凭据。
4. **文件太多太大推不动** → 检查 `.gitignore` 是否生效：`git status --short` 里不应该出现 `data/`、`dist/`、`node_modules/`。
5. **中文文件名乱码** → Git Bash 里正常，PowerShell 里可能显示转义后的字符，不影响实际文件。

---

## 检查清单（推送前对照）

```bash
cd /d/AI工具workbuddy/PrintShelf
git status --short
```

输出里如果看到以下任何一项，说明 `.gitignore` 没生效，先别 push：

- `data/` 开头的文件
- `dist/` 开头的文件
- `node_modules/` 开头的文件
- 任何 `.log` 文件

正常情况下应该是干净的（没有输出），或者只有你刚改的几个源码文件。
