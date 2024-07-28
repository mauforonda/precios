#!/usr/bin/env python

import requests
import re
import pandas as pd
import datetime as dt
import os

def make_timestamp():
    
    return dt.datetime.now(tz=dt.timezone.utc).strftime('%Y-%m-%d')


def get_page(page):
    
    url = 'https://www.ketal.com.bo/index.php?route=product/search&sort=p.date_added&order=DESC&search=&description=true&limit=100&page={}'.format(page)
    try:
        response = requests.get(url, timeout=20)
        if response.status_code == 200:
            data = re.findall('\"ecommerce\"\:\{\"currencyCode\"\:\"BOB\"\,\"impressions\"\:\[(.*)\]\}', response.text)
            if len(data) > 0:
                listado = list(eval(data[0]))
                listado = [i for i in listado if type(i) == dict]
                return listado
    except Exception as e:
        print(e)


def get_all(page=1):

    while True:
        print(page)
        listado = get_page(page)
        if listado is not None:
            productos.extend(listado)
            if len(listado) < 100:
                break
        page += 1


def format_results(productos, timestamp):
    
    df = pd.DataFrame(productos)
    for col in ['price']:
        df[col] = df[col].astype(float)
    for col in ['id', 'quantity']:
        df[col] = df[col].apply(lambda x: x.split('.')[0]).astype(int)
    df = df[['id', 'category', 'brand', 'name', 'price', 'quantity']]
    df.insert(0, 'time', timestamp)
    return df


def save_results(df):

    precios = 'data/ketal/{}.csv'.format(dt.datetime.now().strftime('%Y_%m'))
    productos = 'data/ketal/productos.csv'

    if os.path.exists(precios):
        dfi = pd.concat([pd.read_csv(precios), df[['time', 'id', 'price', 'quantity']]])
    else:
        dfi = df[['time', 'id', 'price', 'quantity']]
    dfi.to_csv(precios, index=False)

    if os.path.exists(productos):
        dfi = pd.concat([pd.read_csv(productos), df[['id', 'category', 'brand', 'name']]])
        dfi.drop_duplicates(subset=['id'], keep='last', inplace=True)
    else:
        dfi = df[['id', 'category', 'brand', 'name']]
    dfi.sort_values('id').to_csv(productos, index=False)


timestamp = make_timestamp()
productos = []
get_all()
df = format_results(productos, timestamp)
save_results(df)
