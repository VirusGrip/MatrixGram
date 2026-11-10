# Звонки 1:1 и существующий TURN

В 0.4.0 реализованы Matrix VoIP v1 room events и настоящий WebRTC media transport. Это не заглушка вызова: браузерный тест соединяет два RTCPeerConnection, проверяет полученные RTP-пакеты, mute и остановку tracks при завершении.

`CallEngine` обрабатывает invite/answer/candidates/hangup/reject/select_answer/negotiate, party_id, срок invite, несколько устройств и одновременный исходящий вызов. При входящем invite проверяется состав комнаты: два joined-участника. Вызовы v0 и групповые вызовы не поддерживаются.

Перед вызовом SDK делает `GET /_matrix/client/v3/voip/turnServer`. ICE URLs и временные credentials используются только модулем вызова; адрес TURN не захардкожен. Новые credentials запрашиваются для каждого нового peer, длительный вызов с ICE restart после истечения TTL пока не реализован. Сервер не меняется.

Аудио/видео запрашиваются по действию пользователя. Есть mute/camera, выбор устройств, демонстрация экрана при поддержке getDisplayMedia. Hangup немедленно останавливает tracks, даже если отправка сигнала не проходит. Закрытие/усыпление мобильного WebView может прервать звонок: фонового Android call service и push нет.

Не проверено: реальный TURN matrix.mad-frog.ru, NAT/relay-only, совместимость с конкретной версией Element, длительные вызовы и Android runtime. Современный Element может использовать MatrixRTC вместо room VoIP. Кнопки вызова не означают подтверждённой совместимости.

Проверка: два тестовых аккаунта, входящий/отклонённый/пропущенный вызов, audio/video, mute, смена камеры, завершение каждой стороной, отказ разрешений, потеря сети; затем `iceTransportPolicy: relay` в тестовой конфигурации и проверка selected candidate pair. Не добавлять SFU/LiveKit без отдельного решения владельца.

Протокол: [Matrix VoIP specification](https://spec.matrix.org/v1.19/client-server-api/#voice-over-ip).
