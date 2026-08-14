import sqlite3 as sql
from json import dumps

conn: object = sql.connect('system_ctl.db') # Create DB file name
Cursor = conn.cursor()

def MetadataSql(i: list[tuple]) -> None:
    Cursor.execute("CREATE TABLE IF NOT EXISTS app_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT, event_s TEXT)") # Create a table with 2 tables with text type
    Cursor.executemany("INSERT INTO app_metadata (message, event_s) VALUES (?, ?)", i)

# Display the contents of the data stored in the database
def get_db_sql() -> object:
    Cursor.execute("SELECT * FROM app_metadata")
    for i in Cursor.fetchall():
        dumps_: object = dumps(i, indent=2)
        print(dumps_) # Display of formatted data
