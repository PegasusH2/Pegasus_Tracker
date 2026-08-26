# Pegasus Tracker

Pegasus Tracker es una aplicación web progresiva (PWA) privada desarrollada para realizar un seguimiento completo del entrenamiento y de la evolución física a lo largo del tiempo.

El proyecto nace con el objetivo de disponer de una herramienta de seguimiento personal que permita registrar los entrenamientos de forma rápida, consultar el historial y analizar la progresión, manteniendo al mismo tiempo un sistema de almacenamiento local que permita utilizar la aplicación incluso sin conexión a Internet.

La aplicación está diseñada específicamente alrededor de las necesidades reales del entrenamiento, evitando depender de estructuras genéricas de seguimiento. El sistema permite registrar ejercicios, series, repeticiones, peso utilizado y RIR, así como trabajar con diferentes estructuras de series y objetivos de progresión.

Además del entrenamiento, Pegasus Tracker incorpora herramientas para realizar un seguimiento de la evolución corporal, incluyendo peso corporal, medidas antropométricas y mediciones mediante plicómetro.

## Seguimiento del entrenamiento

Pegasus Tracker permite registrar sesiones de entrenamiento y consultar posteriormente toda la información histórica.

Cada entrenamiento puede contener diferentes ejercicios y cada ejercicio puede disponer de múltiples series con información específica sobre:

* Peso utilizado.
* Número de repeticiones.
* RIR.
* Tipo de serie.
* Objetivo de repeticiones.
* Objetivo de peso.
* Descansos.
* Diferentes estructuras de progresión.

El sistema está preparado para representar entrenamientos reales, incluyendo rangos de repeticiones, series al fallo, rest-pause, drop sets y otras estructuras utilizadas habitualmente en programación de fuerza e hipertrofia.

## Rutinas

La aplicación permite crear y gestionar rutinas de entrenamiento para utilizarlas posteriormente durante las sesiones.

Las rutinas están separadas de los entrenamientos realizados, permitiendo mantener una programación estructurada y, al mismo tiempo, conservar el historial real de lo que se ha ejecutado.

El sistema también incorpora herramientas para importar rutinas a partir de imágenes mediante inteligencia artificial, facilitando la transformación de una rutina existente en información estructurada dentro de Pegasus Tracker.

## Progresión y estadísticas

Pegasus Tracker incorpora un motor de análisis local para estudiar la evolución del entrenamiento.

La aplicación puede calcular diferentes métricas relacionadas con la progresión, estimaciones de 1RM, récords personales y estadísticas históricas.

El objetivo es que el análisis se base principalmente en los datos reales registrados durante los entrenamientos y no dependa exclusivamente de servicios externos o inteligencia artificial.

Esto permite mantener disponibles las funciones principales de análisis incluso cuando el dispositivo no tiene conexión a Internet.

## Seguimiento corporal

Además del entrenamiento, Pegasus Tracker permite registrar la evolución física mediante diferentes tipos de mediciones.

Actualmente contempla:

* Peso corporal.
* Medidas corporales.
* Perímetros.
* Pliegues cutáneos.
* Seguimiento histórico.
* Evolución de las diferentes mediciones.

Los datos pueden consultarse a lo largo del tiempo para identificar tendencias y cambios en la composición corporal.

## Inteligencia artificial

Pegasus Tracker incorpora inteligencia artificial como herramienta complementaria, principalmente para facilitar la introducción de información.

Uno de los usos principales es la importación de rutinas mediante fotografías.

El proceso permite analizar una imagen de una rutina, identificar ejercicios, series, repeticiones, pesos y estructuras de entrenamiento y convertir la información en datos estructurados que posteriormente pueden ser revisados y almacenados en la aplicación.

La comunicación con el modelo de inteligencia artificial se realiza mediante un Cloudflare Worker, evitando exponer credenciales privadas directamente en el cliente.

La inteligencia artificial no sustituye al sistema de datos ni al motor de progresión de Pegasus Tracker. Se utiliza como una capa adicional para automatizar tareas que de otro modo requerirían introducir manualmente una gran cantidad de información.

## Arquitectura offline-first

Uno de los principios fundamentales del proyecto es el funcionamiento offline-first.

Los datos se almacenan localmente utilizando IndexedDB mediante Dexie.js, permitiendo que la aplicación continúe funcionando aunque el dispositivo no tenga conexión a Internet.

La arquitectura separa la interfaz, la lógica de negocio y la persistencia de datos:

```text
Interfaz
   ↓
Views
   ↓
Core / lógica de negocio
   ↓
Repository
   ↓
Dexie.js
   ↓
IndexedDB
```

Esta separación permite mantener la aplicación independiente de un backend para las operaciones básicas y facilita la evolución futura del proyecto.

La aplicación está planteada para que registrar un entrenamiento no dependa de la disponibilidad de Internet.

## Sincronización multidispositivo

La arquitectura del proyecto está evolucionando hacia un modelo de sincronización cloud que permita utilizar Pegasus Tracker desde diferentes dispositivos manteniendo los datos sincronizados.

El objetivo es conservar el funcionamiento offline de IndexedDB y añadir una capa de sincronización mediante Supabase.

La arquitectura prevista es:

```text
                 Supabase
                    │
              Sync Engine
                    │
        ┌───────────┴───────────┐
        │                       │
      iPhone                    PC
        │                       │
    IndexedDB              IndexedDB
        │                       │
      Dexie                   Dexie
```

De esta forma, cada dispositivo puede seguir funcionando de manera independiente y sincronizar los cambios cuando exista conexión.

La sincronización está planteada para preservar la integridad de los datos, gestionar operaciones realizadas offline y evitar que la disponibilidad de Internet se convierta en un requisito para utilizar la aplicación.

## Tecnologías

Pegasus Tracker está desarrollado utilizando tecnologías web estándar, buscando mantener una arquitectura ligera y fácilmente mantenible.

* HTML5
* CSS3
* Vanilla JavaScript
* ES Modules
* IndexedDB
* Dexie.js
* Chart.js
* Progressive Web App
* Service Worker
* Cloudflare Workers
* Google Gemini
* Supabase

No utiliza frameworks frontend como React, Vue o Angular. La aplicación está construida deliberadamente sobre JavaScript nativo para mantener el proyecto ligero, reducir dependencias y facilitar su ejecución como aplicación web progresiva.

## Objetivos del proyecto

Pegasus Tracker es un proyecto de desarrollo personal orientado a crear una herramienta de seguimiento del entrenamiento que sea rápida, sencilla y capaz de adaptarse progresivamente a las necesidades del usuario.

El proyecto busca combinar:

* Registro rápido durante el entrenamiento.
* Historial completo.
* Análisis de progresión.
* Seguimiento de la evolución corporal.
* Automatización mediante inteligencia artificial.
* Funcionamiento offline.
* Almacenamiento local.
* Sincronización entre dispositivos.
* Arquitectura modular y mantenible.

La intención es que Pegasus Tracker evolucione progresivamente desde una herramienta personal de seguimiento hacia un ecosistema completo para gestionar entrenamiento y evolución física, manteniendo siempre como prioridad la propiedad, integridad y disponibilidad de los datos del usuario.

## Estado del proyecto

Pegasus Tracker se encuentra actualmente en desarrollo activo.

Las funcionalidades se incorporan progresivamente y la arquitectura está siendo preparada para soportar nuevas capacidades sin comprometer el funcionamiento existente.

El proyecto prioriza la estabilidad, la conservación de los datos y una arquitectura sencilla antes que la incorporación rápida de funcionalidades.
