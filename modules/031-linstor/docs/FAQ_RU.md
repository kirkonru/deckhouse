---
title: "Модуль linstor: FAQ"
---

## Когда следует использовать LVM, а когда LVMThin?

Если кратко, то:
- LVM проще и обладает производительностью сравнимой с производительностью накопителя;
- LVMThin позволяет использовать snapshot'ы и overprovisioning, но медленнее в два раза.

## Производительность и надёжность LINSTOR, сравнение с Ceph

> Возможно вам будет интересна наша статья ["Исследование производительности свободных хранилищ LINSTOR, Ceph, Mayastor и Vitastor в Kubernetes"](https://habr.com/ru/company/flant/blog/664150/). 

Мы придерживаемся практического взгляда на вопрос. Разница в несколько десятков процентов на практике никогда не имеет значения. Имеет значение разница в несколько раз и более.

Факторы сравнения:
- Последовательное чтение и запись: не имеют никакого значения, потому что на любой технологии они всегда упираются в сеть (что 10 Гбит/с, что 1 Гбит/с). С практической точки зрения этот показатель можно полностью игнорировать;
- Случайное чтение и запись (что на 1Гбит/с, что на 10Гбит/с):
  - DRBD + LVM в 5 раз лучше чем Ceph RBD (latency — в 5 раз меньше, IOPS — в 5 раз больше);
  - DRBD + LVM в 2 раза лучше чем DRBD + LVMThin.
- Если одна из реплик расположена локально, то скорость чтения будет примерно равна скорости устройства хранения;
- Если нет реплик расположенных локально, то скорость записи будет примерно ограничена половиной пропускной способности сети при двух репликах или ⅓ пропускной способности сети при трех репликах;
- При большом количестве клиентов (больше 10, при iodepth 64), Ceph начинает отставать сильнее (до 10 раз) и потреблять значительно больше CPU.

В сухом остатке получается, что на практике неважно какие параметры менять, и есть всего три значимых фактора:
- **Локальность чтения** — если всё чтение производится локально, то оно работает со скоростью (throughput, IOPS, latency) локального диска (разница практически незаметна); 
- **1 сетевой hop при записи** — в DRBD репликацией занимается *клиент*, а в Ceph — *сервер*, поэтому у Ceph latency на запись всегда минимум в два раза больше чем у DRBD;
- **Сложность кода** — latency вычислений на datapath (сколько процессорных команд выполняется на каждую операцию ввода/вывода), — DRBD + LVM проще чем DRBD + LVMThin, и значительно проще чем Ceph RBD.

## Что использовать в какой ситуации?

По умолчанию модуль использует две реплики (третья — т.н. `diskless`, используется для поддержания кворума и создается автоматически). Такой подход гарантирует защиту от split-brain и достаточный уровень надежности хранения, но нужно учитывать следующие особенности:
  - В момент недоступности одной из реплик (реплика A) данные записываются только в единственную реплику (реплика B). Это означает, что:
    - Если в этот момент отключится и вторая реплика (реплика B), то запись и чтение будут недоступны;
    - Если при этом вторая реплика (реплика B) утеряна безвозвратно, то данные будут частично потеряны (есть только старая реплика A);
    - Если старая реплика (реплика A) была тоже утеряна безвозвратно, то данные будут потеряны полностью.
  - Чтобы включиться обратно при отключении второй реплики (без вмешательства оператора) требуется доступность обеих реплик. Это необходимо, чтобы корректно отработать ситуацию split-brain;
  - Включение третьей реплики решает обе проблемы (в любой момент времени доступно минимум две копии данных), но увеличивает накладные расходы (сеть, диск).

Настоятельно рекомендуется иметь одну реплику локально. Это в два раза увеличивает возможную скорость записи (при двух репликах) и значительно увеличивает скорость чтения. Но даже если реплики на локальном хранилище нет, то все также будет работать нормально, за исключением того, что чтение будет осуществляться по сети и будет двойная утилизация сети при записи.

В зависимости от задачи нужно выбрать один из следующих вариантов:
- DRBD + LVM — быстрей (в два раза) и надежней (LVM — проще);
- DRBD + LVMThin — поддержка snapshot'ов и возможность overprovisioning.

## Как добавить существующий LVM или LVMThin-пул?

Пример добавления LVM-пула:
```shell
linstor storage-pool create lvm node01 lvmthin linstor_data
```

Пример добавления LVMThin-пула:
```shell
linstor storage-pool create lvmthin node01 lvmthin linstor_data/data
```

Можно добавлять и пулы, в которых уже созданы какие-то тома. LINSTOR просто будет создавать в пуле новые тома.

## Как настроить Prometheus на использование хранилища LINSTOR?

Чтобы настроить Prometheus на использование хранилища LINSTOR, необходимо:
- [Настроить](configuration.html#конфигурация-хранилища-linstor) пулы хранения и StorageClass.
- Указать параметры [longtermStorageClass](../300-prometheus/configuration.html#parameters-longtermstorageclass) и [storageClass](../300-prometheus/configuration.html#parameters-storageclass) в конфигурации модуля [prometheus](../300-prometheus/).

  Пример:

  ```yaml
  prometheus: |
    longtermStorageClass: linstor-data-r2
    storageClass: linstor-data-r2
  ```

- Дождаться перезапуска Pod'ов Prometheus.

## Pod не может запуститься из-за ошибки `FailedMount`

### Pod завис на стадии `ContainerCreating`

Если Pod завис на стадии `ContainerCreating`, а в выводе `kubectl describe pod` есть ошибки вида:

```
rpc error: code = Internal desc = NodePublishVolume failed for pvc-b3e51b8a-9733-4d9a-bf34-84e0fee3168d: checking 
for exclusive open failed: wrong medium type, check device health
```

... значит устройство всё ещё смонтировано на одном из других узлов. 

Проверить это можно с помощью следующей команды:

```shell
linstor resource list -r pvc-b3e51b8a-9733-4d9a-bf34-84e0fee3168d
```

Флаг `InUse` укажет на каком узле используется устройство.

### Pod не может запуститься из-за отсутствия CSI-драйвера

Пример ошибки в `kubectl describe pod`:

```
kubernetes.io/csi: attachment for pvc-be5f1991-e0f8-49e1-80c5-ad1174d10023 failed: CSINode b-node0 does not 
contain driver linstor.csi.linbit.com
```

Проверьте состояние Pod'ов `linstor-csi-node`:

```shell
kubectl get pod -n d8-linstor -l app.kubernetes.io/component=csi-node,app.kubernetes.io/instance=linstor,\
app.kubernetes.io/managed-by=piraeus-operator,app.kubernetes.io/name=piraeus-csi
```

Наиболее вероятно, что они зависли в состоянии `Init`, ожидая пока узел сменит статус на `Online` в LINSTOR. Проверьте список узлов с помощью следующей команды:

```shell
linstor node list
```

Если вы видите какие-либо узлы в состоянии `EVICTED`, значит они были недоступны в течении 2‑х часов. Чтобы вернуть их в кластер, выполните:

```shell
linstor node rst <name>
```

### Ошибки вида `Input/output error`

Такие ошибки обычно возникают на стадии создания файловой системы (mkfs).

Проверьте `dmesg` на узле, где запускается Pod:

```shell
dmesg | grep 'Remote failed to finish a request within'
```

Если вывод команды не пустой (в выводе `dmesg` есть строки вида *"Remote failed to finish a request within ..."*), то скорее всего ваша дисковая подсистема слишком медленная для нормального функционирования DRBD.
