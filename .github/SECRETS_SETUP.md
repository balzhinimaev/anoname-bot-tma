# GitHub Secrets Setup

Для работы CI/CD pipeline необходимо настроить следующие секреты в GitHub:

## VPS Connection Secrets (ОБЯЗАТЕЛЬНО)

1. **VPS_HOST** - IP адрес или домен VPS сервера
2. **VPS_USER** - имя пользователя для SSH подключения (обычно root или ubuntu)
3. **VPS_SSH_KEY** - приватный SSH ключ для подключения к VPS

## Bot Configuration Secrets (ОБЯЗАТЕЛЬНО)

4. **BOT_TOKEN** - токен Telegram бота от @BotFather
5. **TELEGRAM_WEBHOOK_PATH** - путь для webhook (например: /telegram/webhook/your-secret)
6. **TELEGRAM_WEBHOOK_SECRET** - секретный токен для webhook
7. **BOT_WEBHOOK_URL** - полный URL для webhook (https://yourdomain.com/telegram/webhook/your-secret)
8. **AUTO_SET_WEBHOOK** - автоматическая установка webhook (true/false)

## Optional Secrets (можно оставить пустыми)

9. **WEB_APP_URL** - URL мини-приложения (если есть)
10. **API_BASE_URL** - базовый URL API бэкенда (если есть)
11. **BOT_BACKEND_SECRET** - секретный ключ для API бэкенда (если есть)
12. **AB_SPLIT_A** - процент для A/B тестирования (0-100, по умолчанию 50)
13. **APP_PORT** - порт приложения (по умолчанию 7777)

## Автоматические секреты

- **GITHUB_TOKEN** - автоматически предоставляется GitHub Actions

## Как добавить секреты:

1. Перейдите в Settings репозитория
2. Выберите Secrets and variables → Actions
3. Нажмите "New repository secret"
4. Добавьте каждый секрет с соответствующим именем и значением

## Генерация SSH ключа:

```bash
# На локальной машине
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/vps_deploy_key

# Скопируйте публичный ключ на VPS
ssh-copy-id -i ~/.ssh/vps_deploy_key.pub user@your-vps-ip

# Добавьте приватный ключ в GitHub Secrets как VPS_SSH_KEY
cat ~/.ssh/vps_deploy_key
```
