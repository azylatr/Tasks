def matrix_2d(matrix: list[list[int]]):
    """
    Process a 2D matrix and return a list of squared values
    that meet specific index and value conditions.

    Rules:
    - Iterate through a 2D list (matrix).
    - For each element, check:
        1. (row_index + column_index) is odd
        2. The element value is even
    - If both conditions are met, square the element.
    - Ignore elements that do not meet the conditions.

    Args:
        matrix (list[list[int]]):
            A 2D list containing integer values.

    Returns:
        list[int]:
            A flat list containing squared integers
            that passed the filtering conditions.
    """
    calculation: list[int] = [
        num
        for sublist in [
            [
                row[col] ** 2
                if (row_idx + col) % 2 == 1 and row[col] % 2 == 0
                else None
                for col in range(len(row))
            ]

            # Add a matrix (2D) to iterate over
            for row_idx, row in enumerate(matrix)
        ]
        for num in sublist
        if num is not None
    ]

    return calculation
