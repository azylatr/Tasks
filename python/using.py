import requests as Req
from json import dumps

def Using(URL: str, file_name: str) -> object:
    """
    Fetch and save Hugging Face dataset rows to a local JSON file.

    Args:
        url: Hugging Face API endpoint for dataset rows.
        file_name: Target output path (JSON).
    output: 
        object {}
    """
    get = Req.get(URL)

    if get.status_code == 200:
        data: object = get.json()
        with open(file_name, "w") as file:
            file.write(dumps(data, indent=3, sort_keys=True))

        # Message successful
        print(f"Your data is already saved in the file {file_name} in JSON format!")
    elif get.status_code == 404:
        print("Failed to fetch the server with status 404!")
    else:
        pass
