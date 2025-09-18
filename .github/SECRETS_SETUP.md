# GitHub Secrets Setup

Для работы CI/CD pipeline необходимо настроить следующие секреты в GitHub:

## VPS Connection Secrets

1. **VPS_HOST** - IP адрес или домен VPS сервера
2. **VPS_USER** - имя пользователя для SSH подключения (обычно root или ubuntu)
3. **VPS_SSH_KEY** - приватный SSH ключ для подключения к VPS
4. **VPS_PORT** - SSH порт (обычно 22)

## Bot Configuration Secrets

5. **BOT_TOKEN** - токен Telegram бота от @BotFather
6. **WEB_APP_URL** - URL мини-приложения
7. **TELEGRAM_WEBHOOK_PATH** - путь для webhook (например: /telegram/webhook)
8. **TELEGRAM_WEBHOOK_SECRET** - секретный токен для webhook
9. **BOT_WEBHOOK_URL** - полный URL для webhook (https://yourdomain.com/telegram/webhook)
10. **AUTO_SET_WEBHOOK** - автоматическая установка webhook (true/false)
11. **API_BASE_URL** - базовый URL API бэкенда
12. **BOT_BACKEND_SECRET** - секретный ключ для API бэкенда
13. **AB_SPLIT_A** - процент для A/B тестирования (0-100)

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
