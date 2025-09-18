# Мониторинг и Health Checks

## Встроенные Health Checks

### Docker Health Check
Контейнер автоматически проверяет здоровье через встроенный health check:
```bash
docker ps  # Покажет статус health check
docker inspect anonamebot  # Детальная информация о health check
```

### HTTP Health Endpoint
Приложение предоставляет HTTP endpoint для проверки здоровья:
```bash
curl http://localhost:8080/healthz
```

## Внешний мониторинг

### Скрипт health-check.sh
Используйте скрипт `scripts/health-check.sh` для комплексной проверки:

```bash
# Базовая проверка
./scripts/health-check.sh

# С настройкой URL
HEALTH_URL=http://your-domain.com/healthz ./scripts/health-check.sh

# С настройкой таймаута
TIMEOUT=30 ./scripts/health-check.sh
```

### Настройка cron для автоматических проверок
```bash
# Добавить в crontab (проверка каждые 5 минут)
*/5 * * * * /opt/mvp-anoname-bot/scripts/health-check.sh >> /var/log/anonamebot-health.log 2>&1
```

## Мониторинг логов

### Docker Compose логи
```bash
cd /opt/mvp-anoname-bot
docker-compose logs -f anonamebot
```

### Ротация логов
Логи сохраняются в `./logs/` директории и должны настраиваться через logrotate:

```bash
# /etc/logrotate.d/anonamebot
/opt/mvp-anoname-bot/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 root root
    postrotate
        docker-compose -f /opt/mvp-anoname-bot/docker-compose.yml restart anonamebot
    endscript
}
```

## Алерты и уведомления

### Простой скрипт для отправки алертов
```bash
#!/bin/bash
# /opt/mvp-anoname-bot/scripts/alert.sh

if ! ./scripts/health-check.sh; then
    # Отправить уведомление (email, Slack, Telegram и т.д.)
    echo "AnonameBot health check failed at $(date)" | mail -s "Bot Alert" admin@yourdomain.com
fi
```

### Интеграция с внешними системами мониторинга
- **Prometheus + Grafana**: Экспорт метрик через `/metrics` endpoint
- **Uptime Robot**: HTTP мониторинг `/healthz` endpoint
- **Pingdom**: Внешний мониторинг доступности

## Метрики для отслеживания

1. **Доступность**: HTTP статус 200 на `/healthz`
2. **Время отклика**: < 3 секунд
3. **Использование памяти**: < 512MB
4. **Использование CPU**: < 50%
5. **Место на диске**: < 90%
6. **Количество активных соединений**
7. **Количество обработанных webhook'ов**

## Troubleshooting

### Контейнер не запускается
```bash
docker-compose logs anonamebot
docker-compose ps
```

### Health check падает
```bash
# Проверить логи приложения
docker-compose logs anonamebot

# Проверить доступность порта
netstat -tlnp | grep 8080

# Проверить .env файл
cat /opt/mvp-anoname-bot/.env
```

### Высокое использование ресурсов
```bash
# Мониторинг ресурсов
docker stats anonamebot

# Проверить процессы
docker exec anonamebot ps aux
```
